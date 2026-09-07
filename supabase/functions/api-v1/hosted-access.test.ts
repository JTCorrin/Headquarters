import { assertEquals, assertRejects } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertHostedOrgAccess } from './hosted-access.ts'
import { ApiError } from './http.ts'

Deno.test('hosted gate accepts active subscriptions and self-host mode', async () => {
  const db = {
    rpc: (name: string, args: unknown) => {
      assertEquals(name, 'hosted_org_access')
      assertEquals(args, { p_org_id: 'org-id' })
      return Promise.resolve({ data: true, error: null })
    },
  } as unknown as SupabaseClient
  await assertHostedOrgAccess(db, 'org-id')
})
Deno.test('hosted gate denies unpaid API-key and user access', async () => {
  const db = {
    rpc: () => Promise.resolve({ data: false, error: null }),
  } as unknown as SupabaseClient
  const error = await assertRejects(() => assertHostedOrgAccess(db, 'org-id'), ApiError)
  assertEquals(error.status, 402)
})
Deno.test('hosted gate fails closed when database check is unavailable', async () => {
  const db = {
    rpc: () => Promise.resolve({ data: null, error: { message: 'unavailable' } }),
  } as unknown as SupabaseClient
  const error = await assertRejects(() => assertHostedOrgAccess(db, 'org-id'), ApiError)
  assertEquals(error.status, 503)
})
