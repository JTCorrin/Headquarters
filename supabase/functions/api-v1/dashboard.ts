import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import { ApiError, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

interface DatabaseError {
  code?: string
  message?: string
}

function assertCanReadDashboard(role: MembershipRole): void {
  // Matches invoice/payment GET audience (billing included).
  void role
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Dashboard summary is forbidden')
  }
  if (error.code === 'P0002' || message.includes('organisation not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Organisation not found')
  }
  console.error('Dashboard summary failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Dashboard summary failed')
}

export async function handleDashboardSummary(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  assertCanReadDashboard(role)

  if (path !== '/api/v1/dashboard/summary') {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }
  if (req.method !== 'GET') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for dashboard summary')
  }

  const { data, error } = await db.rpc('dashboard_money_summary', {
    p_org_id: orgId,
  })
  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data: data as Record<string, Json> }, 200, requestId)
}
