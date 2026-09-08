/**
 * Edge cron entry for mail campaign sends.
 * Header: x-campaigns-cron-secret = CAMPAIGNS_CRON_SECRET
 * Falls back to PLAYBOOKS_CRON_SECRET when CAMPAIGNS_CRON_SECRET is unset.
 */
import { createClient } from '@supabase/supabase-js'
import type { CampaignRecipientRow, CampaignRow, Database } from '../_shared/database.ts'
import { CAMPAIGN_BATCH_SIZE, sendCampaignRecipient } from '../_shared/campaign-send.ts'

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  let diff = 0
  for (let i = 0; i < bufA.byteLength; i++) diff |= bufA[i]! ^ bufB[i]!
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
    })
  }

  const expectedSecret = Deno.env.get('CAMPAIGNS_CRON_SECRET') ??
    Deno.env.get('PLAYBOOKS_CRON_SECRET')
  if (!expectedSecret) {
    console.error('CAMPAIGNS_CRON_SECRET is not configured; refusing to run')
    return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), {
      status: 503,
    })
  }
  const suppliedSecret = req.headers.get('x-campaigns-cron-secret') ??
    req.headers.get('x-playbooks-cron-secret') ??
    ''
  if (!timingSafeEqual(suppliedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
    })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), {
      status: 500,
    })
  }

  const service = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: claimed, error: claimError } = await service.rpc(
    'claim_due_campaigns',
    {
      p_limit: 10,
    },
  )
  if (claimError) {
    console.error('claim_due_campaigns failed', claimError)
    return new Response(JSON.stringify({ error: 'CLAIM_FAILED' }), {
      status: 500,
    })
  }

  const campaigns = (claimed ?? []) as CampaignRow[]
  const results: Array<
    { campaign_id: string; status: string; sent: number; failed: number }
  > = []

  async function activity(
    campaign: CampaignRow,
    level: 'info' | 'warning' | 'error',
    message: string,
  ) {
    const { error } = await service.from('campaign_events').insert({
      org_id: campaign.org_id,
      campaign_id: campaign.id,
      level,
      message,
    })
    if (error) {
      console.error('Campaign activity could not be recorded', {
        code: error.code,
      })
    }
  }

  for (const campaign of campaigns) {
    try {
      if (!campaign.mailbox_id || !campaign.template_id) {
        await activity(
          campaign,
          'error',
          'Sending stopped: select a mailbox and an active template in a new draft.',
        )
        await service
          .from('campaigns')
          .update({
            status: 'failed',
            last_error: 'Campaign is missing mailbox or template',
            completed_at: new Date().toISOString(),
          })
          .eq('id', campaign.id)
          .eq('org_id', campaign.org_id)
        results.push({
          campaign_id: campaign.id,
          status: 'failed',
          sent: 0,
          failed: 0,
        })
        continue
      }

      // Re-check cancelled mid-flight.
      const { data: fresh } = await service
        .from('campaigns')
        .select('id,status,name,mailbox_id,template_id')
        .eq('id', campaign.id)
        .eq('org_id', campaign.org_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (!fresh || fresh.status === 'cancelled') {
        results.push({
          campaign_id: campaign.id,
          status: 'cancelled',
          sent: 0,
          failed: 0,
        })
        continue
      }

      const { data: template } = await service
        .from('email_templates')
        .select('id,subject,body_text,body_html,status')
        .eq('org_id', campaign.org_id)
        .eq('id', campaign.template_id)
        .is('deleted_at', null)
        .maybeSingle()

      if (!template || template.status !== 'active') {
        await activity(
          campaign,
          'error',
          'Sending stopped: the email template is missing or inactive.',
        )
        await service
          .from('campaigns')
          .update({
            status: 'failed',
            last_error: 'Campaign template is missing or not active',
            completed_at: new Date().toISOString(),
          })
          .eq('id', campaign.id)
          .eq('org_id', campaign.org_id)
        results.push({
          campaign_id: campaign.id,
          status: 'failed',
          sent: 0,
          failed: 0,
        })
        continue
      }

      const { data: recipients, error: recipError } = await service.rpc(
        'claim_campaign_recipients',
        {
          p_campaign_id: campaign.id,
          p_org_id: campaign.org_id,
          p_limit: CAMPAIGN_BATCH_SIZE,
        },
      )
      if (recipError) {
        console.error('claim_campaign_recipients failed', recipError)
        await activity(
          campaign,
          'error',
          'The worker could not reserve recipients. It will try again on the next scheduled run.',
        )
        results.push({
          campaign_id: campaign.id,
          status: 'error',
          sent: 0,
          failed: 0,
        })
        continue
      }

      let sent = 0
      let failed = 0
      let pausedForQuota = false

      const batch = (recipients ?? []) as CampaignRecipientRow[]
      if (batch.length) {
        await activity(
          campaign,
          'info',
          `The worker reserved ${batch.length} recipient(s) for sending.`,
        )
      }

      for (let index = 0; index < batch.length; index++) {
        const recipient = batch[index]!
        try {
          // Cancellation can happen while a batch is running. Fail closed on a failed check.
          const { data: current, error: stateError } = await service.from(
            'campaigns',
          )
            .select('status,deleted_at').eq('id', campaign.id).eq(
              'org_id',
              campaign.org_id,
            ).maybeSingle()
          if (
            stateError || !current || current.deleted_at ||
            current.status !== 'sending'
          ) {
            const { error: releaseError } = await service.from(
              'campaign_recipients',
            ).update({ claimed_at: null })
              .in('id', batch.slice(index).map((r) => r.id)).eq(
                'org_id',
                campaign.org_id,
              ).eq('status', 'pending')
            if (releaseError) {
              throw new Error(
                'Could not release recipients after pausing the worker.',
              )
            }
            if (stateError) {
              await activity(
                campaign,
                'warning',
                'Sending paused because the campaign status could not be checked. The worker will try again.',
              )
            }
            break
          }
          const result = await sendCampaignRecipient({
            db: service,
            orgId: campaign.org_id,
            campaignId: campaign.id,
            campaignName: fresh.name,
            mailboxId: campaign.mailbox_id,
            template,
            recipient,
          })
          if (result.ok) {
            sent += 1
          } else if (result.quotaExhausted) {
            pausedForQuota = true
            // No SMTP attempt was made for these recipients, so releasing their claims is safe.
            const { error: releaseError } = await service.from(
              'campaign_recipients',
            ).update({ claimed_at: null })
              .in('id', batch.slice(index).map((r) => r.id)).eq(
                'org_id',
                campaign.org_id,
              ).eq('status', 'pending')
            if (releaseError) {
              throw new Error(
                'Could not release recipients after reaching the daily limit.',
              )
            }
            const next = new Date()
            next.setUTCHours(24, 0, 0, 0)
            const { error: pauseError } = await service.from('campaigns')
              .update({
                next_attempt_at: next.toISOString(),
                last_error:
                  'Daily email send limit reached. Sending resumes after the allowance resets.',
              }).eq('id', campaign.id).eq('org_id', campaign.org_id).eq(
                'status',
                'sending',
              )
            if (pauseError) {
              throw new Error('Could not record the daily-limit pause.')
            }
            await activity(
              campaign,
              'warning',
              'Daily email send limit reached. Remaining recipients will be retried after midnight UTC.',
            )
            break
          } else {
            failed += 1
          }
        } catch (err) {
          console.error('sendCampaignRecipient threw', {
            campaign_id: campaign.id,
            recipient_id: recipient.id,
            err,
          })
          failed += 1
          const { error: markError } = await service.rpc(
            'mark_campaign_recipient_result',
            {
              p_recipient_id: recipient.id,
              p_org_id: campaign.org_id,
              p_status: 'failed',
              p_error: (err instanceof Error ? err.message : 'Unexpected send error')
                .slice(0, 2000),
            },
          )
          if (markError) {
            console.error('Campaign recipient result could not be recorded', {
              code: markError.code,
            })
          }
        }
      }

      if (!pausedForQuota) {
        const { error: finalizeError } = await service.rpc(
          'finalize_campaign_if_done',
          {
            p_campaign_id: campaign.id,
            p_org_id: campaign.org_id,
          },
        )
        if (finalizeError) {
          throw new Error('Could not finalize campaign results.')
        }
      }

      if (batch.length) {
        await activity(
          campaign,
          failed ? 'warning' : 'info',
          `Batch finished: ${sent} accepted by the mail server, ${failed} failed. See recipient results for details.`,
        )
      }

      const { data: after } = await service
        .from('campaigns')
        .select('status')
        .eq('id', campaign.id)
        .maybeSingle()

      results.push({
        campaign_id: campaign.id,
        status: pausedForQuota ? 'sending_quota_paused' : (after?.status ?? 'unknown'),
        sent,
        failed,
      })
    } catch (err) {
      console.error('campaign worker failed for campaign', campaign.id, err)
      await activity(
        campaign,
        'error',
        'The sending worker encountered an error. Unattempted recipients will be retried; check recipient results before resending.',
      )
      results.push({
        campaign_id: campaign.id,
        status: 'error',
        sent: 0,
        failed: 0,
      })
    }
  }

  return new Response(JSON.stringify({ data: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
