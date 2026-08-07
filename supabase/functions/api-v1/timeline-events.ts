import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, TimelineEventRow } from '../_shared/database.ts'
import { ApiError, jsonBody, jsonResponse, parseLimit, parseUuid } from './http.ts'

const TIMELINE_SELECT =
  'id,org_id,entity_type,entity_id,kind,title,body,actor_type,actor_id,source_type,source_id,payload,occurred_at,created_at'

const ENTITY_TYPES = new Set([
  'contact',
  'lead',
  'client',
  'quote',
  'invoice',
  'bill',
])

/** User-composable kinds (system `conversion` is writers-only). */
const USER_KINDS = new Set([
  'note',
  'email',
  'call',
  'payment',
  'document',
  'status',
  'meeting',
  'task',
])

const ENTITY_TABLE: Record<string, string> = {
  contact: 'contacts',
  lead: 'leads',
  client: 'clients',
  quote: 'quotes',
  invoice: 'invoices',
  bill: 'bills',
}

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']
type TimelineEntityType = TimelineEventRow['entity_type']
type TimelineKind = TimelineEventRow['kind']

interface TimelineCursor {
  occurred_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

export type TimelineNoteCreate = {
  kind: TimelineKind
  title: string
  body: string | null
  payload: Json
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  if (error.code === '42501') {
    return new ApiError(
      403,
      'FORBIDDEN',
      error.message ?? 'This action is not permitted',
    )
  }
  if (error.code === 'P0002' || error.code === 'no_data_found') {
    return new ApiError(
      404,
      'NOT_FOUND',
      error.message ?? 'Resource not found',
    )
  }
  if (
    error.code === '23514' || error.code === '23503' || error.code === '22023'
  ) {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      error.message ?? 'Validation failed',
    )
  }
  console.error('Timeline query failed', {
    request_id: requestId,
    code: error.code,
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Timeline operation failed')
}

export function parseEntityType(value: string): TimelineEntityType {
  if (!ENTITY_TYPES.has(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'entity_type is invalid', {
      entity_type: 'Must be contact, lead, client, quote, invoice, or bill',
    })
  }
  return value as TimelineEntityType
}

function assertCanReadTimeline(role: MembershipRole): void {
  // Select RLS already gates lead/conversion rows for billing; HTTP allows all member roles.
  void role
}

function assertCanWriteTimeline(role: MembershipRole): void {
  if (role === 'readonly' || role === 'billing') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only owners, admins, and members can post timeline notes',
    )
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateTimelineNoteBody(
  body: Record<string, unknown>,
): TimelineNoteCreate {
  const fields: Record<string, string> = {}
  const writable = new Set(['kind', 'title', 'body', 'payload'])

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  let kind: TimelineKind = 'note'
  if ('kind' in body) {
    const value = body.kind
    if (typeof value !== 'string' || !USER_KINDS.has(value)) {
      fields.kind = 'Must be a user-composable timeline kind'
    } else {
      kind = value as TimelineKind
    }
  }

  let title = ''
  if (
    typeof body.title !== 'string' || body.title.trim().length < 1 ||
    body.title.trim().length > 200
  ) {
    fields.title = 'Must be a string between 1 and 200 characters'
  } else {
    title = body.title.trim()
  }

  let bodyText: string | null = null
  if ('body' in body) {
    const value = body.body
    if (value !== null && typeof value !== 'string') {
      fields.body = 'Must be a string or null'
    } else if (typeof value === 'string' && value.length > 20_000) {
      fields.body = 'Must not exceed 20000 characters'
    } else {
      bodyText = typeof value === 'string' ? value.trim() || null : null
    }
  }

  let payload: Json = {}
  if ('payload' in body) {
    if (!isPlainObject(body.payload)) {
      fields.payload = 'Must be a JSON object'
    } else {
      const raw = body.payload
      if ('mentions' in raw) {
        const mentions = raw.mentions
        if (!Array.isArray(mentions)) {
          fields.payload = 'mentions must be an array'
        } else if (mentions.length > 20) {
          fields.payload = 'mentions must not exceed 20 entries'
        } else {
          for (const item of mentions) {
            if (!isPlainObject(item) || typeof item.membership_id !== 'string') {
              fields.payload = 'each mention requires membership_id'
              break
            }
            try {
              parseUuid(item.membership_id, 'payload.mentions.membership_id')
            } catch {
              fields.payload = 'each mention membership_id must be a UUID'
              break
            }
          }
        }
      }
      if (!fields.payload) {
        payload = raw as Json
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Timeline event validation failed',
      fields,
    )
  }

  return { kind, title, body: bodyText, payload }
}

export function decodeTimelineCursor(
  value: string | null,
): TimelineCursor | null {
  if (value === null || value === '') return null
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const parsed = JSON.parse(atob(`${base64}${padding}`)) as {
      occurred_at?: unknown
      id?: unknown
    }
    // Strict ISO only: the timestamp is interpolated into a PostgREST `.or()` filter.
    if (
      typeof parsed.occurred_at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(\+00:00|Z)$/.test(parsed.occurred_at) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(
          parsed.id,
        )
    ) {
      throw new Error('invalid')
    }
    return { occurred_at: parsed.occurred_at, id: parsed.id }
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'cursor is invalid', {
      cursor: 'Must be an opaque timeline cursor',
    })
  }
}

function encodeCursor(row: TimelineCursor): string {
  return btoa(JSON.stringify({ occurred_at: row.occurred_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function assertEntityExists(
  db: DatabaseClient,
  orgId: string,
  entityType: TimelineEntityType,
  entityId: string,
  requestId: string,
): Promise<void> {
  const table = ENTITY_TABLE[entityType] as
    | 'contacts'
    | 'leads'
    | 'clients'
    | 'quotes'
    | 'invoices'
    | 'bills'
  const { data, error } = await db
    .from(table)
    .select('id')
    .eq('org_id', orgId)
    .eq('id', entityId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(404, 'NOT_FOUND', `${entityType} not found`)
  }
}

async function listTimelineEvents(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  entityType: TimelineEntityType,
  entityId: string,
  requestId: string,
): Promise<Response> {
  await assertEntityExists(db, orgId, entityType, entityId, requestId)

  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeTimelineCursor(url.searchParams.get('cursor'))

  let query = db
    .from('timeline_events')
    .select(TIMELINE_SELECT)
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursor) {
    // Newest-first keyset: (occurred_at, id) < cursor
    query = query.or(
      `occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const rows = data ?? []
  const hasNextPage = rows.length > limit
  const page = hasNextPage ? rows.slice(0, limit) : rows
  const last = page.at(-1)

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && last
          ? encodeCursor({ occurred_at: last.occurred_at, id: last.id })
          : null,
      },
    },
    200,
    requestId,
  )
}

export type TimelineActorContext = {
  actorType: 'user' | 'api_key'
  apiKeyId?: string | null
}

async function createTimelineNote(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  entityType: TimelineEntityType,
  entityId: string,
  userId: string | null,
  requestId: string,
  actor?: TimelineActorContext,
): Promise<Response> {
  const draft = validateTimelineNoteBody(await jsonBody(req))
  const rpcArgs: {
    p_org_id: string
    p_entity_type: string
    p_entity_id: string
    p_kind: string
    p_title: string
    p_body: string | null
    p_payload: Json
    p_actor_type?: string
    p_actor_id?: string
  } = {
    p_org_id: orgId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_kind: draft.kind,
    p_title: draft.title,
    p_body: draft.body,
    p_payload: draft.payload,
  }

  if (actor?.actorType === 'api_key') {
    if (!actor.apiKeyId) {
      throw new ApiError(403, 'FORBIDDEN', 'API key identity is required for timeline writes')
    }
    rpcArgs.p_actor_type = 'api_key'
    rpcArgs.p_actor_id = actor.apiKeyId
  } else if (!userId) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This route requires a user-backed actor (JWT or API key with created_by)',
    )
  }

  const { data, error } = await db.rpc('create_timeline_event', rpcArgs)

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Timeline create returned no row',
    )
  }

  return jsonResponse({ data }, 201, requestId, {
    location: `/api/v1/entities/${entityType}/${entityId}/timeline-events/${
      (data as TimelineEventRow).id
    }`,
  })
}

export function isOrgTimelineEventsPath(path: string): boolean {
  return path === '/api/v1/timeline-events'
}

async function listOrgTimelineEvents(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeTimelineCursor(url.searchParams.get('cursor'))

  const { data, error } = await db.rpc('list_org_timeline_events', {
    p_org_id: orgId,
    p_limit: limit + 1,
    p_cursor_occurred_at: cursor?.occurred_at ?? null,
    p_cursor_id: cursor?.id ?? null,
  })
  if (error) throw databaseError(error, requestId)

  const rows = (data ?? []) as TimelineEventRow[]
  const hasNextPage = rows.length > limit
  const page = hasNextPage ? rows.slice(0, limit) : rows
  const last = page.at(-1)

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && last
          ? encodeCursor({ occurred_at: last.occurred_at, id: last.id })
          : null,
      },
    },
    200,
    requestId,
  )
}

/** Org-wide Home feed: GET /api/v1/timeline-events (read-only). */
export async function handleOrgTimelineEvents(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (!isOrgTimelineEventsPath(path)) {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }

  if (req.method === 'GET') {
    assertCanReadTimeline(role)
    return await listOrgTimelineEvents(req, db, orgId, requestId)
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
}

export async function handleTimelineEvents(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  userId: string | null,
  requestId: string,
  actor?: TimelineActorContext,
): Promise<Response> {
  const match = path.match(
    /^\/api\/v1\/entities\/([a-z]+)\/([0-9a-f-]{36})\/timeline-events$/i,
  )
  if (!match) {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }

  const entityType = parseEntityType(match[1])
  const entityId = parseUuid(match[2], 'entity_id')

  if (req.method === 'GET') {
    assertCanReadTimeline(role)
    return await listTimelineEvents(
      req,
      db,
      orgId,
      entityType,
      entityId,
      requestId,
    )
  }

  if (req.method === 'POST') {
    assertCanWriteTimeline(role)
    return await createTimelineNote(
      req,
      db,
      orgId,
      entityType,
      entityId,
      userId,
      requestId,
      actor,
    )
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
}
