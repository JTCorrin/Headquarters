/**
 * Campaign send helpers: resolve merge vars, SMTP send, quota, timeline note.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignRecipientRow, Database } from './database.ts'
import { buildCampaignMergeVars, renderMergeTemplate } from './campaign-merge.ts'
import { resolveMailboxAuth } from './mailbox-credentials.ts'
import { generateOutboundMessageId, sendSmtpMail, type SmtpSecurity } from './smtp-outbound.ts'

type Db = SupabaseClient<Database>

export const CAMPAIGN_BATCH_SIZE = 15

async function loadMergeContext(
  db: Db,
  orgId: string,
  entityType: CampaignRecipientRow['entity_type'],
  entityId: string,
): Promise<
  {
    entityName: string | null
    contactName: string | null
    clientName: string | null
    leadName: string | null
  }
> {
  if (entityType === 'contact') {
    const { data } = await db
      .from('contacts')
      .select('display_name')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return {
      entityName: data?.display_name ?? null,
      contactName: data?.display_name ?? null,
      clientName: null,
      leadName: null,
    }
  }
  if (entityType === 'lead') {
    const { data } = await db
      .from('leads')
      .select('name,contact_id,client_id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    let contactName: string | null = null
    let clientName: string | null = null
    if (data?.contact_id) {
      const { data: contact } = await db
        .from('contacts')
        .select('display_name')
        .eq('org_id', orgId)
        .eq('id', data.contact_id)
        .is('deleted_at', null)
        .maybeSingle()
      contactName = contact?.display_name ?? null
    }
    if (data?.client_id) {
      const { data: client } = await db
        .from('clients')
        .select('name')
        .eq('org_id', orgId)
        .eq('id', data.client_id)
        .is('deleted_at', null)
        .maybeSingle()
      clientName = client?.name ?? null
    }
    return {
      entityName: data?.name ?? null,
      contactName,
      clientName,
      leadName: data?.name ?? null,
    }
  }
  const { data } = await db
    .from('clients')
    .select('name')
    .eq('org_id', orgId)
    .eq('id', entityId)
    .is('deleted_at', null)
    .maybeSingle()
  return {
    entityName: data?.name ?? null,
    contactName: null,
    clientName: data?.name ?? null,
    leadName: null,
  }
}

export async function sendCampaignRecipient(input: {
  db: Db
  orgId: string
  campaignId: string
  campaignName: string
  mailboxId: string
  template: { id: string; subject: string; body_text: string | null; body_html: string | null }
  recipient: CampaignRecipientRow
}): Promise<{ ok: true } | { ok: false; error: string; quotaExhausted?: boolean }> {
  const { db, orgId, mailboxId, template, recipient } = input

  if (recipient.status !== 'pending') {
    return { ok: true }
  }

  const { error: quotaError } = await db.rpc('campaign_consume_send_quota', {
    p_org_id: orgId,
    p_mailbox_id: mailboxId,
  })
  if (quotaError) {
    const message = quotaError.message?.toLowerCase() ?? ''
    if (
      quotaError.code === '55006' ||
      message.includes('daily email send limit') ||
      message.includes('quota')
    ) {
      return { ok: false, error: 'Daily email send limit reached', quotaExhausted: true }
    }
    return { ok: false, error: quotaError.message || 'Quota check failed' }
  }

  const mergeCtx = await loadMergeContext(db, orgId, recipient.entity_type, recipient.entity_id)
  const vars = buildCampaignMergeVars({
    entityType: recipient.entity_type,
    entityName: mergeCtx.entityName,
    contactName: mergeCtx.contactName,
    clientName: mergeCtx.clientName,
    leadName: mergeCtx.leadName,
    toName: recipient.to_name,
  })
  const subject = renderMergeTemplate(template.subject, vars)
  const bodyText = renderMergeTemplate(template.body_text ?? '', vars)
  const bodyHtml = template.body_html ? renderMergeTemplate(template.body_html, vars) : null

  const resolved = await resolveMailboxAuth(db, mailboxId)
  if (!resolved) {
    await db.rpc('mark_campaign_recipient_result', {
      p_recipient_id: recipient.id,
      p_org_id: orgId,
      p_status: 'failed',
      p_error: 'Mailbox credentials are not configured',
    })
    return { ok: false, error: 'Mailbox credentials are not configured' }
  }

  const host = resolved.row.smtp_host
  const port = resolved.row.smtp_port
  const security = (resolved.row.smtp_security ?? 'tls') as SmtpSecurity
  const from = resolved.email_address || resolved.row.email_address
  if (!host || !Number.isFinite(port) || !from) {
    await db.rpc('mark_campaign_recipient_result', {
      p_recipient_id: recipient.id,
      p_org_id: orgId,
      p_status: 'failed',
      p_error: 'Mailbox SMTP configuration incomplete',
    })
    return { ok: false, error: 'Mailbox SMTP configuration incomplete' }
  }

  const messageId = generateOutboundMessageId(from)
  try {
    await sendSmtpMail({
      host,
      port,
      security,
      auth: resolved.smtpAuth,
      from,
      to: recipient.to_email,
      subject,
      bodyText,
      bodyHtml,
      messageId,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'SMTP send failed'
    await db.rpc('mark_campaign_recipient_result', {
      p_recipient_id: recipient.id,
      p_org_id: orgId,
      p_status: 'failed',
      p_error: error.slice(0, 2000),
    })
    return { ok: false, error }
  }

  await db.rpc('mark_campaign_recipient_result', {
    p_recipient_id: recipient.id,
    p_org_id: orgId,
    p_status: 'sent',
  })

  const noteBody = `Included in campaign “${input.campaignName}” (${subject}).`
  await db.rpc('create_playbook_timeline_note', {
    p_org_id: orgId,
    p_entity_type: recipient.entity_type,
    p_entity_id: recipient.entity_id,
    p_title: `Campaign: ${input.campaignName}`.slice(0, 80),
    p_body: noteBody,
    p_payload: {
      campaign_id: input.campaignId,
      campaign_recipient_id: recipient.id,
      template_id: template.id,
      note_kind: 'campaign_sent',
    },
  }).catch(() => {
    // Timeline note is best-effort; send already succeeded.
  })

  return { ok: true }
}
