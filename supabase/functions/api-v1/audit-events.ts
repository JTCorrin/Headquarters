import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditEventRow, Database } from '../_shared/database.ts'
import { ApiError, jsonResponse, parseLimit, parseUuid } from './http.ts'

const AUDIT_SELECT =
  'id,org_id,actor_type,actor_id,action,resource_type,resource_id,request_id,ip_address,user_agent,before_data,after_data,metadata,created_at'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

interface AuditCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  if (error.code === '42501') {
    return new ApiError(
      403,
      'FORBIDDEN',
      error.message ?? 'This action is not permitted',
    )
  }
  console.error('Audit query failed', {
    request_id: requestId,
    code: error.code,
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Audit operation failed')
}

function assertCanReadAudit(role: MembershipRole): void {
  if (role !== 'owner' && role !== 'admin') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only owners and admins can list audit events',
    )
  }
}

function parseIsoTimestamp(
  value: string | null,
  field: string,
): string | null {
  if (value === null || value === '') return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    throw new ApiError(400, 'BAD_REQUEST', `${field} is invalid`, {
      [field]: 'Must be an ISO-8601 timestamp',
    })
  }
  return new Date(ms).toISOString()
}

export function parseAuditActionFilter(value: string | null): string | null {
  if (value === null || value === '') return null
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new ApiError(400, 'BAD_REQUEST', 'action is invalid', {
      action: 'Must be 1–120 characters',
    })
  }
  if (!/^[a-z][a-z0-9_.]*$/.test(trimmed)) {
    throw new ApiError(400, 'BAD_REQUEST', 'action is invalid', {
      action: 'Must be a lowercase machine code (e.g. org.name_changed)',
    })
  }
  return trimmed
}

/** Category is the action namespace prefix (e.g. `org` → `org.%`). */
export function parseAuditCategoryFilter(value: string | null): string | null {
  if (value === null || value === '') return null
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > 64) {
    throw new ApiError(400, 'BAD_REQUEST', 'category is invalid', {
      category: 'Must be 1–64 characters',
    })
  }
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
    throw new ApiError(400, 'BAD_REQUEST', 'category is invalid', {
      category: 'Must be a lowercase namespace (e.g. org, membership)',
    })
  }
  return trimmed
}

export function decodeAuditCursor(value: string | null): AuditCursor | null {
  if (value === null || value === '') return null
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const parsed = JSON.parse(atob(`${base64}${padding}`)) as Partial<AuditCursor>
    if (
      typeof parsed.created_at !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.created_at ||
      !parsed.id
    ) {
      throw new Error('invalid')
    }
    // Validate shapes early so bad cursors fail closed. The timestamp must be
    // strict ISO because it is interpolated into a PostgREST `.or()` filter.
    parseUuid(parsed.id, 'cursor.id')
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(\+00:00|Z)$/.test(parsed.created_at)
    ) {
      throw new Error('invalid')
    }
    return { created_at: parsed.created_at, id: parsed.id }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'BAD_REQUEST', 'cursor is invalid', {
      cursor: 'Must be an opaque audit cursor',
    })
  }
}

function encodeCursor(row: AuditCursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function listAuditEvents(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeAuditCursor(url.searchParams.get('cursor'))
  const from = parseIsoTimestamp(url.searchParams.get('from'), 'from')
  const to = parseIsoTimestamp(url.searchParams.get('to'), 'to')
  const action = parseAuditActionFilter(url.searchParams.get('action'))
  const category = parseAuditCategoryFilter(url.searchParams.get('category'))
  const actorParam = url.searchParams.get('actor_id')
  const actorId = actorParam && actorParam !== '' ? parseUuid(actorParam, 'actor_id') : null

  if (from && to && from > to) {
    throw new ApiError(400, 'BAD_REQUEST', 'from must be <= to', {
      from: 'Must be earlier than or equal to to',
      to: 'Must be later than or equal to from',
    })
  }

  if (action && category && !action.startsWith(`${category}.`)) {
    throw new ApiError(400, 'BAD_REQUEST', 'action and category disagree', {
      action: 'Must belong to the supplied category namespace',
      category: 'Must be a prefix of action',
    })
  }

  let query = db
    .from('audit_events')
    .select(AUDIT_SELECT)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)
  if (action) query = query.eq('action', action)
  if (category && !action) query = query.like('action', `${category}.%`)
  if (actorId) query = query.eq('actor_id', actorId)

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const rows = (data ?? []) as AuditEventRow[]
  const hasNextPage = rows.length > limit
  const page = hasNextPage ? rows.slice(0, limit) : rows
  const last = page.at(-1)

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && last
          ? encodeCursor({ created_at: last.created_at, id: last.id })
          : null,
      },
    },
    200,
    requestId,
  )
}

export async function handleAuditEvents(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (path !== '/api/v1/audit-events') {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }

  if (req.method === 'GET') {
    assertCanReadAudit(role)
    return await listAuditEvents(req, db, orgId, requestId)
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
}
