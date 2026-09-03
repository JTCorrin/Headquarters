import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, MembershipRow } from '../_shared/database.ts'
import { ApiError, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>

/**
 * Lists active personal mailboxes in the org (safe metadata only — no secrets).
 * Used by campaign from-picker (send via any linked member mailbox).
 */
export async function handleOrganisationMailboxes(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRow['role'],
  requestId: string,
): Promise<Response> {
  if (path !== '/api/v1/organisation/mailboxes') {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }
  if (req.method !== 'GET') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for organisation mailboxes')
  }
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot list organisation mailboxes')
  }

  const { data: mailboxes, error } = await db
    .from('mailbox_accounts')
    .select(
      'id,org_id,membership_id,email_address,from_name,status,created_at,updated_at',
    )
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('email_address', { ascending: true })

  if (error) {
    console.error('Organisation mailboxes list failed', {
      request_id: requestId,
      code: error.code ?? 'unknown',
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Organisation mailboxes list failed')
  }

  const membershipIds = [...new Set((mailboxes ?? []).map((m) => m.membership_id))]
  let memberLabels = new Map<string, string>()
  if (membershipIds.length > 0) {
    const { data: members } = await db.rpc('list_org_members', { p_org_id: orgId })
    const rows = (
      Array.isArray(members)
        ? members
        : typeof members === 'string'
        ? (JSON.parse(members) as unknown[])
        : []
    ) as Array<Record<string, unknown>>
    memberLabels = new Map(
      rows
        .filter((row) => typeof row.membership_id === 'string')
        .map((row) => {
          const id = String(row.membership_id)
          const display =
            (typeof row.display_name === 'string' && row.display_name.trim()) ||
            'Member'
          return [id, display] as const
        }),
    )
  }

  const data = (mailboxes ?? []).map((row) => ({
    id: row.id,
    org_id: row.org_id,
    membership_id: row.membership_id,
    email_address: row.email_address,
    from_name: row.from_name,
    status: row.status,
    member_display_name: memberLabels.get(row.membership_id) ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))

  return jsonResponse({ data }, 200, requestId)
}
