import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, TaskRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const TASK_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,title,description,priority,status,assignee_membership_id,assignee_agent_id,due_at,started_at,completed_at,blocked_reason,source,entity_type,entity_id,meeting_id,project_card_id,position,metadata'

const WRITABLE_FIELDS = new Set([
  'title',
  'description',
  'priority',
  'status',
  'assignee_membership_id',
  'due_at',
  'started_at',
  'completed_at',
  'blocked_reason',
  'source',
  'entity_type',
  'entity_id',
  'position',
  'metadata',
])

const PRIORITIES = new Set(['p1', 'p2', 'p3', 'p4'])
const STATUSES = new Set(['open', 'in_progress', 'blocked', 'done', 'cancelled'])
const SOURCES = new Set(['manual', 'meeting', 'email', 'workflow', 'agent'])
const ENTITY_TYPES = new Set(['contact', 'lead', 'client', 'project'])

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

type DatabaseTask = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']
type TaskPriority = TaskRow['priority']
type TaskStatus = TaskRow['status']
type TaskSource = TaskRow['source']
type TaskEntityType = NonNullable<TaskRow['entity_type']>

type TaskWritable = {
  title?: string
  description?: string | null
  priority?: TaskPriority
  status?: TaskStatus
  assignee_membership_id?: string | null
  due_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  blocked_reason?: string | null
  source?: TaskSource
  entity_type?: TaskEntityType | null
  entity_id?: string | null
  position?: number
  metadata?: Json
}
type TaskCreate = TaskWritable & {
  title: string
  priority: TaskPriority
  status: TaskStatus
  source: TaskSource
  position: number
}
type TaskUpdate = TaskWritable

interface TaskCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

function parseOptionalTimestamp(
  value: unknown,
  field: string,
  fields: Record<string, string>,
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    fields[field] = 'Must be an ISO-8601 timestamp or null'
    return undefined
  }
  return value
}

export function validateTaskBody(
  body: Record<string, unknown>,
  partial: false,
): TaskCreate
export function validateTaskBody(
  body: Record<string, unknown>,
  partial: true,
): TaskUpdate
export function validateTaskBody(
  body: Record<string, unknown>,
  partial: boolean,
): TaskCreate | TaskUpdate {
  const fields: Record<string, string> = {}
  const output: TaskUpdate = {}

  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'title' in body) {
    const value = body.title
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
      fields.title = 'Must be a string between 1 and 200 characters'
    } else {
      output.title = value.trim()
    }
  }

  if ('description' in body) {
    const value = body.description
    if (value !== null && typeof value !== 'string') {
      fields.description = 'Must be a string or null'
    } else if (typeof value === 'string' && value.length > 20_000) {
      fields.description = 'Must not exceed 20000 characters'
    } else {
      output.description = typeof value === 'string' ? value || null : null
    }
  }

  if ('priority' in body) {
    const value = body.priority
    if (typeof value !== 'string' || !PRIORITIES.has(value)) {
      fields.priority = 'Must be p1, p2, p3, or p4'
    } else {
      output.priority = value as TaskPriority
    }
  } else if (!partial) {
    output.priority = 'p3'
  }

  if ('status' in body) {
    const value = body.status
    if (typeof value !== 'string' || !STATUSES.has(value)) {
      fields.status = 'Must be open, in_progress, blocked, done, or cancelled'
    } else {
      output.status = value as TaskStatus
    }
  } else if (!partial) {
    output.status = 'open'
  }

  if ('assignee_membership_id' in body) {
    const value = body.assignee_membership_id
    if (value === null) {
      output.assignee_membership_id = null
    } else if (typeof value === 'string') {
      try {
        output.assignee_membership_id = parseUuid(value, 'assignee_membership_id')
      } catch {
        fields.assignee_membership_id = 'Must be a UUID or null'
      }
    } else {
      fields.assignee_membership_id = 'Must be a UUID or null'
    }
  }

  for (const field of ['due_at', 'started_at', 'completed_at'] as const) {
    if (!(field in body)) continue
    const parsed = parseOptionalTimestamp(body[field], field, fields)
    if (parsed !== undefined || body[field] === null) {
      output[field] = parsed ?? null
    }
  }

  if ('blocked_reason' in body) {
    const value = body.blocked_reason
    if (value !== null && typeof value !== 'string') {
      fields.blocked_reason = 'Must be a string or null'
    } else if (typeof value === 'string' && (value.trim().length < 1 || value.length > 2000)) {
      fields.blocked_reason = 'Must be between 1 and 2000 characters, or null'
    } else {
      output.blocked_reason = typeof value === 'string' ? value.trim() : null
    }
  }

  if ('source' in body) {
    const value = body.source
    if (typeof value !== 'string' || !SOURCES.has(value)) {
      fields.source = 'Must be manual, meeting, email, workflow, or agent'
    } else {
      output.source = value as TaskSource
    }
  } else if (!partial) {
    output.source = 'manual'
  }

  const hasEntityType = 'entity_type' in body
  const hasEntityId = 'entity_id' in body
  if (hasEntityType) {
    const value = body.entity_type
    if (value === null) {
      output.entity_type = null
    } else if (typeof value !== 'string' || !ENTITY_TYPES.has(value)) {
      fields.entity_type = 'Must be contact, lead, client, project, or null'
    } else {
      output.entity_type = value as TaskEntityType
    }
  }
  if (hasEntityId) {
    const value = body.entity_id
    if (value === null) {
      output.entity_id = null
    } else if (typeof value === 'string') {
      try {
        output.entity_id = parseUuid(value, 'entity_id')
      } catch {
        fields.entity_id = 'Must be a UUID or null'
      }
    } else {
      fields.entity_id = 'Must be a UUID or null'
    }
  }
  if (!partial && (hasEntityType || hasEntityId)) {
    const entityType = output.entity_type ?? null
    const entityId = output.entity_id ?? null
    if ((entityType === null) !== (entityId === null)) {
      fields.entity_type = 'entity_type and entity_id must both be set or both be null'
      fields.entity_id = 'entity_type and entity_id must both be set or both be null'
    }
  }
  if (partial && hasEntityType && !hasEntityId && output.entity_type !== null) {
    fields.entity_id = 'entity_id is required when setting entity_type'
  }
  if (partial && hasEntityId && !hasEntityType && output.entity_id !== null) {
    fields.entity_type = 'entity_type is required when setting entity_id'
  }
  if (partial && hasEntityType && hasEntityId) {
    const entityType = output.entity_type ?? null
    const entityId = output.entity_id ?? null
    if ((entityType === null) !== (entityId === null)) {
      fields.entity_type = 'entity_type and entity_id must both be set or both be null'
      fields.entity_id = 'entity_type and entity_id must both be set or both be null'
    }
  }

  if ('position' in body) {
    const value = body.position
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fields.position = 'Must be a finite number'
    } else {
      output.position = value
    }
  } else if (!partial) {
    output.position = 0
  }

  if ('metadata' in body) {
    const value = body.metadata
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fields.metadata = 'Must be a JSON object'
    } else if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384) {
      fields.metadata = 'Must not exceed 16 KiB'
    } else {
      output.metadata = value as Json
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Task validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as TaskCreate | TaskUpdate
}

function encodeCursor(task: TaskCursor): string {
  return btoa(JSON.stringify({ created_at: task.created_at, id: task.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeTaskCursor(value: string): TaskCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<TaskCursor>
    const createdAt = cursor.created_at
    const id = parseUuid(cursor.id ?? null, 'cursor')
    if (
      typeof createdAt !== 'string' ||
      !ISO_TIMESTAMP.test(createdAt) ||
      Number.isNaN(Date.parse(createdAt))
    ) {
      throw new Error('Invalid timestamp')
    }
    return { created_at: createdAt, id }
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'cursor is invalid', {
      cursor: 'Must be a cursor returned by this endpoint',
    })
  }
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  if (error.message?.toLowerCase().includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Task version does not match If-Match')
  }
  if (
    error.message?.toLowerCase().includes('assignee must be') ||
    error.message?.toLowerCase().includes('entity')
  ) {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'Task reference is invalid')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The task conflicts with an existing record')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', 'The task failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Task not found')
  }
  console.error('Task database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The task operation failed')
}

function applyStatusTimestamps(
  payload: TaskUpdate,
  currentStatus?: TaskStatus,
): TaskUpdate {
  const next = { ...payload }
  const status = next.status
  if (!status) return next

  if (status === 'in_progress' && next.started_at === undefined) {
    if (!currentStatus || currentStatus !== 'in_progress') {
      next.started_at = new Date().toISOString()
    }
  }
  if ((status === 'done' || status === 'cancelled') && next.completed_at === undefined) {
    if (!currentStatus || (currentStatus !== 'done' && currentStatus !== 'cancelled')) {
      next.completed_at = new Date().toISOString()
    }
  }
  if (
    status !== 'done' &&
    status !== 'cancelled' &&
    currentStatus &&
    (currentStatus === 'done' || currentStatus === 'cancelled') &&
    next.completed_at === undefined
  ) {
    next.completed_at = null
  }
  return next
}

async function listTasks(
  req: Request,
  db: DatabaseTask,
  orgId: string,
  membershipId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const status = url.searchParams.get('status')
  if (status && !STATUSES.has(status)) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is invalid')
  }

  const assignee = url.searchParams.get('assignee')
  if (assignee && assignee !== 'me') {
    throw new ApiError(400, 'BAD_REQUEST', 'assignee filter must be me when provided')
  }

  const entityType = url.searchParams.get('entity_type')
  const entityId = url.searchParams.get('entity_id')
  if ((entityType === null) !== (entityId === null)) {
    throw new ApiError(400, 'BAD_REQUEST', 'entity_type and entity_id must be provided together', {
      entity_type: 'Required with entity_id',
      entity_id: 'Required with entity_type',
    })
  }
  if (entityType !== null && !ENTITY_TYPES.has(entityType)) {
    throw new ApiError(400, 'BAD_REQUEST', 'entity_type is invalid', {
      entity_type: 'Must be contact, lead, client, or project',
    })
  }

  const meetingIdRaw = url.searchParams.get('meeting_id')
  const projectCardIdRaw = url.searchParams.get('project_card_id')
  const meetingId = meetingIdRaw === null ? null : parseUuid(meetingIdRaw, 'meeting_id')
  const projectCardId = projectCardIdRaw === null
    ? null
    : parseUuid(projectCardIdRaw, 'project_card_id')

  let query = db
    .from('tasks')
    .select(TASK_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (status) {
    query = query.eq('status', status as TaskStatus)
  }
  if (assignee === 'me') {
    query = query.eq('assignee_membership_id', membershipId)
  }
  if (entityType !== null && entityId !== null) {
    query = query
      .eq('entity_type', entityType as TaskEntityType)
      .eq('entity_id', parseUuid(entityId, 'entity_id'))
  }
  if (meetingId !== null) {
    query = query.eq('meeting_id', meetingId)
  }
  if (projectCardId !== null) {
    query = query.eq('project_card_id', projectCardId)
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeTaskCursor(cursorValue)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const tasks = data ?? []
  const hasNextPage = tasks.length > limit
  const page = hasNextPage ? tasks.slice(0, limit) : tasks
  const lastTask = page.at(-1) as TaskCursor | undefined

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && lastTask ? encodeCursor(lastTask) : null,
      },
    },
    200,
    requestId,
  )
}

async function createTask(
  req: Request,
  db: DatabaseTask,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = applyStatusTimestamps(
    validateTaskBody(await jsonBody(req), false),
  ) as TaskCreate
  const { data, error } = await db
    .from('tasks')
    .insert({ ...payload, org_id: orgId, assignee_agent_id: null })
    .select(TASK_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/tasks/${data.id}`,
  })
}

async function findTask(
  db: DatabaseTask,
  orgId: string,
  taskId: string,
  requestId: string,
): Promise<TaskRow> {
  const { data, error } = await db
    .from('tasks')
    .select(TASK_SELECT)
    .eq('org_id', orgId)
    .eq('id', taskId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Task not found')
  return data
}

async function getTask(
  db: DatabaseTask,
  orgId: string,
  taskId: string,
  requestId: string,
): Promise<Response> {
  const data = await findTask(db, orgId, taskId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateTask(
  req: Request,
  db: DatabaseTask,
  orgId: string,
  taskId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findTask(db, orgId, taskId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Task version does not match If-Match')
  }

  const payload = applyStatusTimestamps(
    validateTaskBody(await jsonBody(req), true),
    current.status,
  )
  const { data, error } = await db
    .from('tasks')
    .update(payload)
    .eq('org_id', orgId)
    .eq('id', taskId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(TASK_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Task changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteTask(
  req: Request,
  db: DatabaseTask,
  orgId: string,
  taskId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { error } = await db.rpc('soft_delete_task', {
    p_task_id: taskId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

export function handleTasks(
  req: Request,
  db: DatabaseTask,
  path: string,
  orgId: string,
  _role: MembershipRole,
  membershipId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/tasks') {
    if (req.method === 'GET') {
      return listTasks(req, db, orgId, membershipId, requestId)
    }
    if (req.method === 'POST') return createTask(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for tasks')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const taskId = itemMatch[1]
  if (req.method === 'GET') return getTask(db, orgId, taskId, requestId)
  if (req.method === 'PATCH') return updateTask(req, db, orgId, taskId, requestId)
  if (req.method === 'DELETE') return deleteTask(req, db, orgId, taskId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for task')
}
