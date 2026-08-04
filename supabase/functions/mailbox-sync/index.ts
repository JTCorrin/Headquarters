/**
 * Edge cron entry for bounded mailbox sync.
 * Invoke periodically (e.g. every 5m) with service role or verify_jwt=false + internal secret.
 * Locked bounds live on mailbox_accounts / claim_mailbox_sync_lease.
 */
import { createClient } from '@supabase/supabase-js'
import { runMailboxSyncCycle } from '../api-v1/email-messages.ts'

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  let diff = 0
  for (let i = 0; i < bufA.byteLength; i++) diff |= bufA[i] ^ bufB[i]
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), { status: 405 })
  }

  // verify_jwt=false for this function, so fail closed unless the internal
  // cron secret is configured and supplied by the caller.
  const expectedSecret = Deno.env.get('MAILBOX_SYNC_SECRET')
  if (!expectedSecret) {
    console.error('MAILBOX_SYNC_SECRET is not configured; refusing to run')
    return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), { status: 503 })
  }
  const suppliedSecret = req.headers.get('x-mailbox-sync-secret') ?? ''
  if (!timingSafeEqual(suppliedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), { status: 500 })
  }

  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await service.rpc('list_mailboxes_due_for_sync', { p_limit: 20 })
  if (error) {
    console.error('list_mailboxes_due_for_sync failed', { code: error.code })
    return new Response(JSON.stringify({ error: 'LIST_FAILED' }), { status: 500 })
  }

  const mailboxes = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>
  const holder = `cron-${crypto.randomUUID()}`
  const results = []
  for (const row of mailboxes) {
    const id = String(row.id ?? '')
    if (!id) continue
    const result = await runMailboxSyncCycle(id, `${holder}:${id}`)
    results.push({ mailbox_id: id, ...result })
  }

  return new Response(
    JSON.stringify({
      data: {
        scanned: mailboxes.length,
        results,
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
})
