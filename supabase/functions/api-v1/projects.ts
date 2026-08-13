import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  Json,
  ProjectCardRow,
  ProjectColumnRow,
  ProjectRow,
} from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const PROJECT_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,client_id,name,description,status,owner_membership_id,starts_on,due_on,completed_at,position'

const COLUMN_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,project_id,name,key,position,wip_limit'

const CARD_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,project_id,column_id,title,description,assignee_membership_id,task_id,due_at,position,completed_at'

const PROJECT_WRITABLE = new Set([
  'client_id',
  'name',
  'description',
  'status',
  'owner_membership_id',
  'starts_on',
  'due_on',
  'completed_at',
  'position',
])

const INTERNAL_CLIENT_LABEL = 'Internal'

const COLUMN_WRITABLE = new Set(['name', 'key', 'position', 'wip_limit'])
const COLUMN_PATCH_WRITABLE = new Set(['name', 'position', 'wip_limit'])

const CARD_WRITABLE = new Set([
  'title',
  'description',
  'assignee_membership_id',
  'due_at',
  'column_id',
  'position',
  'completed_at',
])

const STATUSES = new Set(['planning', 'active', 'blocked', 'done', 'archived'])
const KEY_RE = /^[a-z][a-z0-9_-]*$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Matches Postgres `numeric(20, 10)`: 10 digits before the decimal, 10 after. */
const POSITION_ABS_LIMIT = 10_000_000_000

type DatabaseProject = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']
type ProjectStatus = ProjectRow['status']

type ProjectWritable = {
  client_id?: string | null
  name?: string
  description?: string | null
  status?: ProjectStatus
  owner_membership_id?: string | null
  starts_on?: string | null
  due_on?: string | null
  completed_at?: string | null
  position?: number
}

type ProjectCreate = ProjectWritable & { name: string }
type ProjectUpdate = ProjectWritable

type ColumnCreate = {
  name: string
  key?: string
  position?: number
  wip_limit?: number | null
}

type ColumnUpdate = {
  name?: string
  position?: number
  wip_limit?: number | null
}

type CardCreate = {
  title: string
  column_id?: string
  description?: string | null
  assignee_membership_id?: string | null
  due_at?: string | null
  position?: number
}

type CardUpdate = {
  title?: string
  description?: string | null
  assignee_membership_id?: string | null
  due_at?: string | null
  column_id?: string
  position?: number
  completed_at?: string | null
}

interface ProjectCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

type ColumnWithCards = ProjectColumnRow & { cards: ProjectCardRow[] }

type ProjectHost = ProjectRow & {
  client_label: string | null
  columns: ColumnWithCards[]
}

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function isValidPosition(value: number): boolean {
  if (!Number.isFinite(value) || Math.abs(value) >= POSITION_ABS_LIMIT) return false
  const scaled = value * 1e10
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

function slugifyKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
  if (!slug || !KEY_RE.test(slug)) {
    return `col-${crypto.randomUUID().slice(0, 8)}`
  }
  return slug.slice(0, 40)
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

function parseOptionalDate(
  value: unknown,
  field: string,
  fields: Record<string, string>,
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !isValidDateOnly(value)) {
    fields[field] = 'Must be a date (YYYY-MM-DD) or null'
    return undefined
  }
  return value
}

export function parseProjectStatusFilter(url: URL): string[] | null {
  const repeated = url.searchParams.getAll('status')
  const values = repeated.length > 0
    ? repeated.flatMap((entry) => entry.split(','))
    : (url.searchParams.get('status')?.split(',') ?? [])
  const trimmed = values.map((value) => value.trim()).filter(Boolean)
  return trimmed.length > 0 ? trimmed : null
}

export function validateProjectBody(
  body: Record<string, unknown>,
  partial: false,
): ProjectCreate
export function validateProjectBody(
  body: Record<string, unknown>,
  partial: true,
): ProjectUpdate
export function validateProjectBody(
  body: Record<string, unknown>,
  partial: boolean,
): ProjectCreate | ProjectUpdate {
  const fields: Record<string, string> = {}
  const output: ProjectUpdate = {}

  for (const key of Object.keys(body)) {
    if (!PROJECT_WRITABLE.has(key)) {
      fields[key] = 'Field is not writable'
    }
  }

  if (!partial || 'client_id' in body) {
    const value = body.client_id
    if (value === null || value === undefined) {
      output.client_id = null
    } else {
      try {
        output.client_id = parseUuid(typeof value === 'string' ? value : null, 'client_id')
      } catch {
        fields.client_id = 'Must be a UUID or null'
      }
    }
  }

  if (!partial || 'name' in body) {
    const value = body.name
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
      fields.name = 'Must be a string between 1 and 200 characters'
    } else {
      output.name = value.trim()
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

  if ('status' in body) {
    const value = body.status
    if (typeof value !== 'string' || !STATUSES.has(value)) {
      fields.status = 'Must be planning, active, blocked, done, or archived'
    } else {
      output.status = value as ProjectStatus
    }
  } else if (!partial) {
    output.status = 'planning'
  }

  if ('owner_membership_id' in body) {
    if (body.owner_membership_id === null) {
      output.owner_membership_id = null
    } else {
      try {
        output.owner_membership_id = parseUuid(
          String(body.owner_membership_id),
          'owner_membership_id',
        )
      } catch {
        fields.owner_membership_id = 'Must be a UUID or null'
      }
    }
  }

  for (const field of ['starts_on', 'due_on'] as const) {
    if (!(field in body)) continue
    const parsed = parseOptionalDate(body[field], field, fields)
    if (parsed !== undefined || body[field] === null) {
      output[field] = parsed ?? null
    }
  }

  if ('completed_at' in body) {
    const parsed = parseOptionalTimestamp(body.completed_at, 'completed_at', fields)
    if (parsed !== undefined || body.completed_at === null) {
      output.completed_at = parsed ?? null
    }
  }

  if ('position' in body) {
    const value = body.position
    if (typeof value !== 'number' || !isValidPosition(value)) {
      fields.position = 'Must be a finite number within numeric(20,10) bounds'
    } else {
      output.position = value
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Project validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as ProjectCreate | ProjectUpdate
}

export function validateProjectColumnBody(
  body: Record<string, unknown>,
  partial: boolean,
): ColumnCreate | ColumnUpdate {
  const fields: Record<string, string> = {}
  const output: ColumnCreate | ColumnUpdate = {}
  const allowed = partial ? COLUMN_PATCH_WRITABLE : COLUMN_WRITABLE

  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'name' in body) {
    const value = body.name
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80) {
      fields.name = 'Must be a string between 1 and 80 characters'
    } else {
      output.name = value.trim()
    }
  }

  if (!partial && 'key' in body || partial && 'key' in body) {
    const value = body.key
    if (value === undefined && partial) {
      // skip
    } else if (
      typeof value !== 'string' || value.length < 1 || value.length > 40 || !KEY_RE.test(value)
    ) {
      fields.key = 'Must be a slug between 1 and 40 characters (a-z, 0-9, _, -)'
    } else {
      ;(output as ColumnCreate).key = value
    }
  }

  if ('position' in body) {
    const value = body.position
    if (typeof value !== 'number' || !isValidPosition(value)) {
      fields.position = 'Must be a finite number within numeric(20,10) bounds'
    } else {
      output.position = value
    }
  }

  if ('wip_limit' in body) {
    const value = body.wip_limit
    if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
      fields.wip_limit = 'Must be a non-negative integer or null'
    } else {
      output.wip_limit = value as number | null
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Project column validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output
}

export function validateProjectCardBody(
  body: Record<string, unknown>,
  partial: false,
): CardCreate
export function validateProjectCardBody(
  body: Record<string, unknown>,
  partial: true,
): CardUpdate
export function validateProjectCardBody(
  body: Record<string, unknown>,
  partial: boolean,
): CardCreate | CardUpdate {
  const fields: Record<string, string> = {}
  const output: CardUpdate = {}

  for (const key of Object.keys(body)) {
    if (!CARD_WRITABLE.has(key)) fields[key] = 'Field is not writable'
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

  if ('assignee_membership_id' in body) {
    if (body.assignee_membership_id === null) {
      output.assignee_membership_id = null
    } else {
      try {
        output.assignee_membership_id = parseUuid(
          String(body.assignee_membership_id),
          'assignee_membership_id',
        )
      } catch {
        fields.assignee_membership_id = 'Must be a UUID or null'
      }
    }
  }

  if ('column_id' in body) {
    try {
      output.column_id = parseUuid(String(body.column_id), 'column_id')
    } catch {
      fields.column_id = 'Must be a UUID'
    }
  }

  if ('due_at' in body) {
    const parsed = parseOptionalTimestamp(body.due_at, 'due_at', fields)
    if (parsed !== undefined || body.due_at === null) {
      output.due_at = parsed ?? null
    }
  }

  if ('completed_at' in body) {
    const parsed = parseOptionalTimestamp(body.completed_at, 'completed_at', fields)
    if (parsed !== undefined || body.completed_at === null) {
      output.completed_at = parsed ?? null
    }
  }

  if ('position' in body) {
    const value = body.position
    if (typeof value !== 'number' || !isValidPosition(value)) {
      fields.position = 'Must be a finite number within numeric(20,10) bounds'
    } else {
      output.position = value
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Project card validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as CardCreate | CardUpdate
}

function encodeCursor(cursor: ProjectCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeProjectCursor(value: string): ProjectCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<ProjectCursor>
    const id = parseUuid(cursor.id ?? null, 'cursor')
    const createdAt = cursor.created_at
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
  const message = error.message ?? ''
  const lower = message.toLowerCase()
  if (lower.includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Resource version does not match If-Match')
  }
  if (
    lower.includes('client must be') ||
    lower.includes('owner must be') ||
    lower.includes('assignee must be') ||
    lower.includes('column must belong') ||
    lower.includes('column has live cards') ||
    lower.includes('not found in organisation')
  ) {
    return new ApiError(422, 'VALIDATION_ERROR', message || 'Project reference is invalid')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The project conflicts with an existing record')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '22023') {
    // Deliberate RAISE from our own RPCs; the message is user-facing.
    return new ApiError(422, 'VALIDATION_ERROR', message || 'Project validation failed')
  }
  if (error.code === '23514') {
    // Postgres-generated constraint messages leak schema details; keep generic.
    return new ApiError(422, 'VALIDATION_ERROR', 'The project failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Project resource not found')
  }
  console.error('Project database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The project operation failed')
}

async function resolveClientLabel(
  db: DatabaseProject,
  orgId: string,
  clientId: string | null,
): Promise<string | null> {
  if (!clientId) return INTERNAL_CLIENT_LABEL
  const { data } = await db
    .from('clients')
    .select('name')
    .eq('org_id', orgId)
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()
  return data?.name ?? null
}

async function resolveClientLabels(
  db: DatabaseProject,
  orgId: string,
  clientIds: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(clientIds.filter((id): id is string => Boolean(id)))]
  const labels = new Map<string, string>()
  if (unique.length === 0) return labels
  const { data } = await db
    .from('clients')
    .select('id, name')
    .eq('org_id', orgId)
    .in('id', unique)
    .is('deleted_at', null)
  for (const row of data ?? []) {
    if (row.name) labels.set(row.id, row.name)
  }
  return labels
}

async function findProject(
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  requestId: string,
): Promise<ProjectRow> {
  const { data, error } = await db
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('org_id', orgId)
    .eq('id', projectId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Project not found')
  return data
}

async function loadNestedProject(
  db: DatabaseProject,
  orgId: string,
  project: ProjectRow,
  requestId: string,
): Promise<ProjectHost> {
  const [client_label, columnsResult, cardsResult] = await Promise.all([
    resolveClientLabel(db, orgId, project.client_id),
    db
      .from('project_columns')
      .select(COLUMN_SELECT)
      .eq('org_id', orgId)
      .eq('project_id', project.id)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .order('id', { ascending: true }),
    db
      .from('project_cards')
      .select(CARD_SELECT)
      .eq('org_id', orgId)
      .eq('project_id', project.id)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .order('id', { ascending: true }),
  ])

  if (columnsResult.error) throw databaseError(columnsResult.error, requestId)
  if (cardsResult.error) throw databaseError(cardsResult.error, requestId)

  const cardsByColumn = new Map<string, ProjectCardRow[]>()
  for (const card of cardsResult.data ?? []) {
    const list = cardsByColumn.get(card.column_id) ?? []
    list.push(card)
    cardsByColumn.set(card.column_id, list)
  }

  const columns: ColumnWithCards[] = (columnsResult.data ?? []).map((column) => ({
    ...column,
    cards: cardsByColumn.get(column.id) ?? [],
  }))

  return { ...project, client_label, columns }
}

async function findBacklogColumnId(
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  requestId: string,
): Promise<string> {
  const { data, error } = await db
    .from('project_columns')
    .select('id')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .eq('key', 'backlog')
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Project has no backlog column')
  }
  return data.id
}

async function listProjects(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const statusFilter = parseProjectStatusFilter(url)

  if (statusFilter) {
    for (const status of statusFilter) {
      if (!STATUSES.has(status)) {
        throw new ApiError(400, 'BAD_REQUEST', 'status is invalid')
      }
    }
  }

  const clientId = url.searchParams.get('client_id')
  if (clientId) {
    try {
      parseUuid(clientId, 'client_id')
    } catch {
      throw new ApiError(400, 'BAD_REQUEST', 'client_id is invalid')
    }
  }

  let query = db
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (statusFilter) {
    query = query.in('status', statusFilter as ProjectStatus[])
  } else {
    query = query.neq('status', 'archived')
  }

  if (clientId) {
    query = query.eq('client_id', clientId)
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeProjectCursor(cursorValue)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const projects = data ?? []
  const hasNextPage = projects.length > limit
  const page = hasNextPage ? projects.slice(0, limit) : projects
  const last = page.at(-1)
  const labels = await resolveClientLabels(
    db,
    orgId,
    page.map((project) => project.client_id),
  )

  return jsonResponse(
    {
      data: page.map((project) => ({
        ...project,
        client_label: project.client_id
          ? (labels.get(project.client_id) ?? null)
          : INTERNAL_CLIENT_LABEL,
      })),
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

async function createProject(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  requestId: string,
  actorUserId?: string | null,
): Promise<Response> {
  const body = await jsonBody(req)
  const payload = validateProjectBody(body, false)

  // API-key / service_role path has no auth.uid(); pass creator user id as p_actor_id.
  const { data, error } = await db.rpc('create_project_with_defaults', {
    p_org_id: orgId,
    p_payload: payload as Json,
    ...(actorUserId ? { p_actor_id: actorUserId } : {}),
  })

  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Project create returned invalid payload')
  }

  const row = data as Record<string, unknown>
  const project = row as unknown as ProjectHost
  const client_label = await resolveClientLabel(db, orgId, project.client_id)

  return jsonResponse({ data: { ...project, client_label } }, 201, requestId, {
    etag: etag(Number(project.version)),
    location: `/api/v1/projects/${project.id}`,
  })
}

async function getProject(
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  requestId: string,
): Promise<Response> {
  const project = await findProject(db, orgId, projectId, requestId)
  const host = await loadNestedProject(db, orgId, project, requestId)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(project.version) })
}

async function updateProject(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  await findProject(db, orgId, projectId, requestId)

  const payload = validateProjectBody(await jsonBody(req), true)

  const { data, error } = await db
    .from('projects')
    .update(payload)
    .eq('org_id', orgId)
    .eq('id', projectId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(PROJECT_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Project changed during this request')
  }

  const host = await loadNestedProject(db, orgId, data, requestId)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(data.version) })
}

async function deleteProject(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { error } = await db.rpc('soft_delete_project', {
    p_project_id: projectId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function createColumn(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  requestId: string,
): Promise<Response> {
  await findProject(db, orgId, projectId, requestId)
  const body = await jsonBody(req)
  const payload = validateProjectColumnBody(body, false) as ColumnCreate
  const key = payload.key ?? slugifyKey(payload.name)

  const { data, error } = await db
    .from('project_columns')
    .insert({
      org_id: orgId,
      project_id: projectId,
      name: payload.name,
      key,
      position: payload.position ?? 0,
      wip_limit: payload.wip_limit ?? null,
    })
    .select(COLUMN_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data: { ...data, cards: [] } }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/projects/${projectId}/columns/${data.id}`,
  })
}

async function updateColumn(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  columnId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  await findProject(db, orgId, projectId, requestId)

  const payload = validateProjectColumnBody(await jsonBody(req), true)

  const { data, error } = await db
    .from('project_columns')
    .update(payload)
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .eq('id', columnId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(COLUMN_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Project column changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteColumn(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  columnId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  await findProject(db, orgId, projectId, requestId)

  const { error } = await db.rpc('soft_delete_project_column', {
    p_column_id: columnId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function createCard(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  requestId: string,
): Promise<Response> {
  await findProject(db, orgId, projectId, requestId)
  const payload = validateProjectCardBody(await jsonBody(req), false)

  const columnId = payload.column_id ?? await findBacklogColumnId(db, orgId, projectId, requestId)

  const { data, error } = await db
    .from('project_cards')
    .insert({
      org_id: orgId,
      project_id: projectId,
      column_id: columnId,
      title: payload.title,
      description: payload.description ?? null,
      assignee_membership_id: payload.assignee_membership_id ?? null,
      due_at: payload.due_at ?? null,
      position: payload.position ?? 0,
    })
    .select(CARD_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/projects/${projectId}/cards/${data.id}`,
  })
}

async function findCard(
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  cardId: string,
  requestId: string,
): Promise<ProjectCardRow> {
  const { data, error } = await db
    .from('project_cards')
    .select(CARD_SELECT)
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .eq('id', cardId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Project card not found')
  return data
}

async function updateCard(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  cardId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  await findCard(db, orgId, projectId, cardId, requestId)

  const payload = validateProjectCardBody(await jsonBody(req), true)

  const { data, error } = await db
    .from('project_cards')
    .update(payload)
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .eq('id', cardId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(CARD_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Project card changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteCard(
  req: Request,
  db: DatabaseProject,
  orgId: string,
  projectId: string,
  cardId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  await findCard(db, orgId, projectId, cardId, requestId)

  const { error } = await db.rpc('soft_delete_project_card', {
    p_card_id: cardId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

export function handleProjects(
  req: Request,
  db: DatabaseProject,
  path: string,
  orgId: string,
  _role: MembershipRole,
  requestId: string,
  actorUserId?: string | null,
): Promise<Response> {
  if (path === '/api/v1/projects') {
    if (req.method === 'GET') return listProjects(req, db, orgId, requestId)
    if (req.method === 'POST') {
      return createProject(req, db, orgId, requestId, actorUserId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for projects')
  }

  const itemMatch = path.match(new RegExp(`^/api/v1/projects/(${UUID_RE})$`, 'i'))
  if (itemMatch) {
    const projectId = itemMatch[1]
    if (req.method === 'GET') return getProject(db, orgId, projectId, requestId)
    if (req.method === 'PATCH') return updateProject(req, db, orgId, projectId, requestId)
    if (req.method === 'DELETE') return deleteProject(req, db, orgId, projectId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for project')
  }

  const columnsMatch = path.match(
    new RegExp(`^/api/v1/projects/(${UUID_RE})/columns$`, 'i'),
  )
  if (columnsMatch) {
    const projectId = columnsMatch[1]
    if (req.method === 'POST') return createColumn(req, db, orgId, projectId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for project columns')
  }

  const columnItemMatch = path.match(
    new RegExp(`^/api/v1/projects/(${UUID_RE})/columns/(${UUID_RE})$`, 'i'),
  )
  if (columnItemMatch) {
    const projectId = columnItemMatch[1]
    const columnId = columnItemMatch[2]
    if (req.method === 'PATCH') {
      return updateColumn(req, db, orgId, projectId, columnId, requestId)
    }
    if (req.method === 'DELETE') {
      return deleteColumn(req, db, orgId, projectId, columnId, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for project column')
  }

  const cardsMatch = path.match(
    new RegExp(`^/api/v1/projects/(${UUID_RE})/cards$`, 'i'),
  )
  if (cardsMatch) {
    const projectId = cardsMatch[1]
    if (req.method === 'POST') return createCard(req, db, orgId, projectId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for project cards')
  }

  const cardItemMatch = path.match(
    new RegExp(`^/api/v1/projects/(${UUID_RE})/cards/(${UUID_RE})$`, 'i'),
  )
  if (cardItemMatch) {
    const projectId = cardItemMatch[1]
    const cardId = cardItemMatch[2]
    if (req.method === 'PATCH') return updateCard(req, db, orgId, projectId, cardId, requestId)
    if (req.method === 'DELETE') return deleteCard(req, db, orgId, projectId, cardId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for project card')
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
