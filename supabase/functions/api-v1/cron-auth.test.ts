import { assertEquals } from '@std/assert'
import { authorizeCronRequest, routerAuthMode } from '../_shared/cron-auth.ts'

Deno.test('authorizeCronRequest fails closed when secret env is missing', () => {
  const result = authorizeCronRequest(
    new Request('http://local/cron', { method: 'POST' }),
    {
      envSecret: undefined,
      headerName: 'x-mailbox-sync-secret',
    },
  )
  assertEquals(result, {
    ok: false,
    status: 503,
    error: 'SERVICE_UNAVAILABLE',
  })
})

Deno.test('authorizeCronRequest rejects wrong secret', () => {
  const result = authorizeCronRequest(
    new Request('http://local/cron', {
      method: 'POST',
      headers: { 'x-mailbox-sync-secret': 'wrong' },
    }),
    {
      envSecret: 'expected-secret',
      headerName: 'x-mailbox-sync-secret',
    },
  )
  assertEquals(result, { ok: false, status: 401, error: 'UNAUTHORIZED' })
})

Deno.test('authorizeCronRequest accepts matching secret', () => {
  const result = authorizeCronRequest(
    new Request('http://local/cron', {
      method: 'POST',
      headers: { 'x-recurring-invoices-cron-secret': 'cron-ok' },
    }),
    {
      envSecret: 'cron-ok',
      headerName: 'x-recurring-invoices-cron-secret',
    },
  )
  assertEquals(result, { ok: true })
})

Deno.test('routerAuthMode routes crm_key_ bearer tokens to api_key', () => {
  const key = `crm_key_${'a'.repeat(32)}`
  assertEquals(routerAuthMode(`Bearer ${key}`), 'api_key')
  assertEquals(routerAuthMode('Bearer crm_key_short'), 'user')
  assertEquals(routerAuthMode('Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig'), 'user')
  assertEquals(routerAuthMode(null), 'user')
})
