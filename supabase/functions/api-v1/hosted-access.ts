import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.ts'

/** Database configuration is authoritative, including for service-role-backed organisation API keys. */
export async function assertHostedOrgAccess(db: SupabaseClient, orgId: string): Promise<void> {
  const { data, error } = await db.rpc('hosted_org_access', { p_org_id: orgId })
  if (error) throw new ApiError(503, 'INTERNAL_ERROR', 'Subscription access could not be verified')
  if (data !== true) {
    throw new ApiError(402, 'FORBIDDEN', 'An active hosted subscription is required')
  }
}
