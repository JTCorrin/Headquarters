import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import { ApiError, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

interface DatabaseError {
  code?: string
  message?: string
}

function assertCanListOrgMembers(role: MembershipRole): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot list organisation members')
  }
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Organisation members are forbidden')
  }
  console.error('Org members list failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Organisation members list failed')
}

export async function handleOrgMembers(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  assertCanListOrgMembers(role)

  if (path !== '/api/v1/me/org-members') {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }
  if (req.method !== 'GET') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for org-members')
  }

  const { data, error } = await db.rpc('list_org_members', {
    p_org_id: orgId,
  })
  if (error) throw databaseError(error, requestId)

  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, Json>>
  return jsonResponse({ data: rows }, 200, requestId)
}
