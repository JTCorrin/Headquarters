/**
 * Edge cron entry for due recurring invoice schedules.
 * Invoke periodically (e.g. every 1–5m) with verify_jwt=false + internal secret.
 */
import { createClient } from '@supabase/supabase-js'

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

  const expectedSecret = Deno.env.get('RECURRING_INVOICES_CRON_SECRET')
  if (!expectedSecret) {
    console.error('RECURRING_INVOICES_CRON_SECRET is not configured; refusing to run')
    return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), { status: 503 })
  }
  const suppliedSecret = req.headers.get('x-recurring-invoices-cron-secret') ?? ''
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

  const holder = `cron-${crypto.randomUUID()}`
  const { data, error } = await service.rpc('process_due_recurring_schedules', {
    p_limit: 20,
    p_claimed_by: holder,
  })
  if (error) {
    console.error('process_due_recurring_schedules failed', { code: error.code, message: error.message })
    return new Response(JSON.stringify({ error: 'PROCESS_FAILED' }), { status: 500 })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
