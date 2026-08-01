import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContactRow, Database, Json } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const CONTACT_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,first_name,last_name,display_name,primary_email,primary_phone,job_title,company_name,owner_membership_id,lifecycle_status,source,notes,last_contacted_at,metadata'

const WRITABLE_FIELDS = new Set([
  'first_name',
  'last_name',
  'display_name',
  'primary_email',
  'primary_phone',
  'job_title',
  'company_name',
  'owner_membership_id',
  'lifecycle_status',
  'source',
  'notes',
  'metadata',
])

const NULLABLE_TEXT_FIELDS = [
  'first_name',
  'last_name',
  'primary_email',
  'primary_phone',
  'job_title',
  'company_name',
  'source',
  'notes',
] as const

const TEXT_LIMITS: Record<(typeof NULLABLE_TEXT_FIELDS)[number], number> = {
  first_name: 200,
  last_name: 200,
  primary_email: 320,
  primary_phone: 64,
  job_title: 200,
  company_name: 200,
  source: 120,
  notes: 20_000,
}

const LIFECYCLE_STATUSES = new Set(['active', 'inactive', 'archived'])

type DatabaseClient = SupabaseClient<Database>
type ContactLifecycle = ContactRow['lifecycle_status']
type ContactWritable = {
  first_name?: string | null
  last_name?: string | null
  display_name?: string
  primary_email?: string | null
  primary_phone?: string | null
  job_title?: string | null
  company_name?: string | null
  owner_membership_id?: string | null
  lifecycle_status?: ContactLifecycle
  source?: string | null
  notes?: string | null
  metadata?: Json
}
type ContactCreate = ContactWritable & { display_name: string }
type ContactUpdate = ContactWritable

interface ContactCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

export function validateContactBody(
  body: Record<string, unknown>,
  partial: false,
): ContactCreate
export function validateContactBody(
  body: Record<string, unknown>,
  partial: true,
): ContactUpdate
export function validateContactBody(
  body: Record<string, unknown>,
  partial: boolean,
): ContactCreate | ContactUpdate {
  const fields: Record<string, string> = {}
  const output: ContactUpdate = {}

  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'display_name' in body) {
    const value = body.display_name
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
      fields.display_name = 'Must be a string between 1 and 200 characters'
    } else {
      output.display_name = value.trim()
    }
  }

  for (const field of NULLABLE_TEXT_FIELDS) {
    if (!(field in body)) continue
    const value = body[field]
    if (value !== null && typeof value !== 'string') {
      fields[field] = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > TEXT_LIMITS[field]) {
      fields[field] = `Must not exceed ${TEXT_LIMITS[field]} characters`
    } else {
      output[field] = typeof value === 'string' ? value.trim() || null : null
    }
  }

  if ('primary_email' in output && typeof output.primary_email === 'string') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output.primary_email)) {
      fields.primary_email = 'Must be a valid email address'
    }
  }

  if ('owner_membership_id' in body) {
    const value = body.owner_membership_id
    if (value === null) {
      output.owner_membership_id = null
    } else {
      try {
        output.owner_membership_id = parseUuid(
          typeof value === 'string' ? value : null,
          'owner_membership_id',
        )
      } catch {
        fields.owner_membership_id = 'Must be a UUID or null'
      }
    }
  }

  if ('lifecycle_status' in body) {
    const value = body.lifecycle_status
    if (typeof value !== 'string' || !LIFECYCLE_STATUSES.has(value)) {
      fields.lifecycle_status = 'Must be active, inactive, or archived'
    } else {
      output.lifecycle_status = value as ContactLifecycle
    }
  } else if (!partial) {
    output.lifecycle_status = 'active'
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
    throw new ApiError(422, 'VALIDATION_ERROR', 'Contact validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as ContactCreate | ContactUpdate
}

function encodeCursor(contact: ContactCursor): string {
  return btoa(JSON.stringify({ created_at: contact.created_at, id: contact.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeCursor(value: string): ContactCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<ContactCursor>
    const createdAt = cursor.created_at
    const id = parseUuid(cursor.id ?? null, 'cursor')
    if (
      typeof createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        createdAt,
      ) ||
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
    return new ApiError(412, 'PRECONDITION_FAILED', 'Contact version does not match If-Match')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The contact conflicts with an existing record')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', 'The contact failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Contact not found')
  }
  console.error('Contact database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The contact operation failed')
}

async function listContacts(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const lifecycleStatus = url.searchParams.get('lifecycle_status')
  if (lifecycleStatus && !LIFECYCLE_STATUSES.has(lifecycleStatus)) {
    throw new ApiError(400, 'BAD_REQUEST', 'lifecycle_status is invalid')
  }

  let query = db
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (lifecycleStatus) {
    query = query.eq('lifecycle_status', lifecycleStatus as ContactLifecycle)
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeCursor(cursorValue)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const contacts = data ?? []
  const hasNextPage = contacts.length > limit
  const page = hasNextPage ? contacts.slice(0, limit) : contacts
  const lastContact = page.at(-1) as ContactCursor | undefined

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && lastContact ? encodeCursor(lastContact) : null,
      },
    },
    200,
    requestId,
  )
}

async function createContact(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateContactBody(await jsonBody(req), false)
  const { data, error } = await db
    .from('contacts')
    .insert({ ...payload, org_id: orgId })
    .select(CONTACT_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/contacts/${data.id}`,
  })
}

async function findContact(
  db: DatabaseClient,
  orgId: string,
  contactId: string,
  requestId: string,
): Promise<ContactRow> {
  const { data, error } = await db
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('org_id', orgId)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Contact not found')
  return data
}

async function getContact(
  db: DatabaseClient,
  orgId: string,
  contactId: string,
  requestId: string,
): Promise<Response> {
  const data = await findContact(db, orgId, contactId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateContact(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  contactId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findContact(db, orgId, contactId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Contact version does not match If-Match')
  }

  const payload = validateContactBody(await jsonBody(req), true)
  const { data, error } = await db
    .from('contacts')
    .update(payload)
    .eq('org_id', orgId)
    .eq('id', contactId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(CONTACT_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Contact changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteContact(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  contactId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  // Direct UPDATE ... deleted_at hits RLS 42501 for authenticated callers on
  // staging; mutate through the security-definer RPC (same pattern as quotes).
  const { error } = await db.rpc('soft_delete_contact', {
    p_contact_id: contactId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

export function handleContacts(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/contacts') {
    if (req.method === 'GET') return listContacts(req, db, orgId, requestId)
    if (req.method === 'POST') return createContact(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for contacts')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/contacts\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const contactId = itemMatch[1]
  if (req.method === 'GET') return getContact(db, orgId, contactId, requestId)
  if (req.method === 'PATCH') {
    return updateContact(req, db, orgId, contactId, requestId)
  }
  if (req.method === 'DELETE') {
    return deleteContact(req, db, orgId, contactId, requestId)
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for contact')
}
