import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import { ApiError, jsonBody, jsonResponse, parseLimit, parseUuid } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

interface NotificationCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

function assertCanAccessNotifications(role: MembershipRole): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access notifications')
  }
}

function databaseError(error: DatabaseError, requestId: string, fallback: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Notifications are forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Notification not found')
  }
  console.error(fallback, {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', fallback)
}

export function decodeNotificationCursor(value: string | null): NotificationCursor | null {
  if (value === null || value === '') return null
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const parsed = JSON.parse(atob(`${base64}${padding}`)) as Partial<NotificationCursor>
    if (
      typeof parsed.created_at !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.created_at ||
      !parsed.id
    ) {
      throw new Error('invalid')
    }
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
      cursor: 'Must be an opaque notifications cursor',
    })
  }
}

function encodeCursor(row: NotificationCursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function listMyNotifications(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeNotificationCursor(url.searchParams.get('cursor'))

  const { data, error } = await db.rpc('list_my_notifications', {
    p_org_id: orgId,
    p_limit: limit + 1,
    p_cursor_created_at: cursor?.created_at ?? null,
    p_cursor_id: cursor?.id ?? null,
  })
  if (error) throw databaseError(error, requestId, 'Notifications list failed')

  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, Json>>
  const hasNextPage = rows.length > limit
  const page = hasNextPage ? rows.slice(0, limit) : rows
  const last = page.at(-1)
  const lastCreatedAt = typeof last?.created_at === 'string' ? last.created_at : null
  const lastId = typeof last?.id === 'string' ? last.id : null

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && lastCreatedAt && lastId
          ? encodeCursor({ created_at: lastCreatedAt, id: lastId })
          : null,
      },
    },
    200,
    requestId,
  )
}

async function getUnreadCount(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('count_my_unread_notifications', {
    p_org_id: orgId,
  })
  if (error) throw databaseError(error, requestId, 'Unread notification count failed')

  const count = typeof data === 'number' ? data : Number(data ?? 0)
  return jsonResponse({ data: { count: Number.isFinite(count) ? count : 0 } }, 200, requestId)
}

async function markNotificationRead(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  notificationId: string,
  requestId: string,
): Promise<Response> {
  const body = await jsonBody(req)
  if (body.read !== true) {
    throw new ApiError(400, 'BAD_REQUEST', 'Only { "read": true } is supported', {
      read: 'Must be true',
    })
  }

  const { data, error } = await db.rpc('mark_notification_read', {
    p_org_id: orgId,
    p_notification_id: notificationId,
  })
  if (error) throw databaseError(error, requestId, 'Mark notification read failed')

  return jsonResponse({ data }, 200, requestId)
}

export async function handleNotifications(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  assertCanAccessNotifications(role)

  if (path === '/api/v1/me/notifications/unread-count') {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for unread-count')
    }
    return await getUnreadCount(db, orgId, requestId)
  }

  if (path === '/api/v1/me/notifications') {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for notifications list')
    }
    return await listMyNotifications(req, db, orgId, requestId)
  }

  const markMatch = path.match(/^\/api\/v1\/me\/notifications\/([0-9a-f-]{36})$/i)
  if (markMatch) {
    if (req.method !== 'PATCH') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for notification')
    }
    return await markNotificationRead(req, db, orgId, markMatch[1], requestId)
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
