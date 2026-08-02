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

/** Virtual write field — persists via client_contacts, not contacts.client_id. */
const VIRTUAL_FIELDS = new Set(['client_id'])

export type ContactWithClientId = ContactRow & { client_id: string | null }

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

/** Extract optional client_id before row validation (not a contacts column). */
export function extractContactClientId(body: Record<string, unknown>): {
  provided: boolean
  clientId: string | null
} {
  if (!('client_id' in body)) return { provided: false, clientId: null }

  const value = body.client_id
  if (value === null) return { provided: true, clientId: null }
  try {
    return {
      provided: true,
      clientId: parseUuid(typeof value === 'string' ? value : null, 'client_id'),
    }
  } catch {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Contact validation failed', {
      client_id: 'Must be a UUID or null',
    })
  }
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
    if (!WRITABLE_FIELDS.has(key) && !VIRTUAL_FIELDS.has(key)) {
      fields[key] = 'Field is not writable'
    }
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
  const hasVirtual = Object.keys(body).some((key) => VIRTUAL_FIELDS.has(key))
  if (partial && Object.keys(output).length === 0 && !hasVirtual) {
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

  const contacts = (data ?? []) as ContactRow[]
  const hasNextPage = contacts.length > limit
  const page = hasNextPage ? contacts.slice(0, limit) : contacts
  const lastContact = page.at(-1) as ContactCursor | undefined
  const clientIds = await resolveContactClientIds(
    db,
    orgId,
    page.map((contact) => contact.id),
    requestId,
  )

  return jsonResponse(
    {
      data: page.map((contact) => withClientId(contact, clientIds)),
      meta: {
        next_cursor: hasNextPage && lastContact ? encodeCursor(lastContact) : null,
      },
    },
    200,
    requestId,
  )
}

type ContactRpcResult = {
  contact: ContactRow
  client_id: string | null
}

function parseContactRpcResult(data: unknown, requestId: string): ContactRpcResult {
  if (!data || typeof data !== 'object') {
    console.error('Contact RPC returned unexpected payload', { request_id: requestId })
    throw new ApiError(500, 'INTERNAL_ERROR', 'The contact operation failed')
  }
  const row = data as { contact?: ContactRow; client_id?: string | null }
  if (!row.contact || typeof row.contact !== 'object') {
    console.error('Contact RPC missing contact row', { request_id: requestId })
    throw new ApiError(500, 'INTERNAL_ERROR', 'The contact operation failed')
  }
  return {
    contact: row.contact,
    client_id: row.client_id ?? null,
  }
}

function mapContactClientRpcError(error: DatabaseError, requestId: string): ApiError {
  if (error.message?.toLowerCase().includes('contact client must be an active client')) {
    return new ApiError(422, 'VALIDATION_ERROR', 'Contact validation failed', {
      client_id: 'Must reference an active client in this organisation',
    })
  }
  return databaseError(error, requestId)
}

/** Resolve form client_id from the contact's primary client_contacts link only. */
async function resolveContactClientIds(
  db: DatabaseClient,
  orgId: string,
  contactIds: string[],
  requestId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (contactIds.length === 0) return map

  const { data, error } = await db
    .from('client_contacts')
    .select('contact_id, client_id')
    .eq('org_id', orgId)
    .in('contact_id', contactIds)
    .eq('is_primary', true)
    .is('deleted_at', null)

  if (error) throw databaseError(error, requestId)

  for (const row of data ?? []) {
    map.set(row.contact_id, row.client_id)
  }
  return map
}

function withClientId(
  contact: ContactRow,
  clientIds: Map<string, string>,
): ContactWithClientId {
  return { ...contact, client_id: clientIds.get(contact.id) ?? null }
}

async function createContact(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const body = await jsonBody(req)
  const clientLink = extractContactClientId(body)
  const payload = validateContactBody(body, false)
  // Atomic contact insert + optional primary client_contacts link (no orphan on 422).
  const { data, error } = await db.rpc('create_contact_with_primary_client', {
    p_org_id: orgId,
    p_payload: payload,
    p_client_id: clientLink.clientId,
    p_set_client_id: clientLink.provided,
  })

  if (error) throw mapContactClientRpcError(error, requestId)

  const result = parseContactRpcResult(data, requestId)
  return jsonResponse(
    { data: { ...result.contact, client_id: result.client_id } },
    201,
    requestId,
    {
      etag: etag(result.contact.version),
      location: `/api/v1/contacts/${result.contact.id}`,
    },
  )
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
  const clientIds = await resolveContactClientIds(db, orgId, [data.id], requestId)
  return jsonResponse({ data: withClientId(data, clientIds) }, 200, requestId, {
    etag: etag(data.version),
  })
}

async function updateContact(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  contactId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const body = await jsonBody(req)
  const clientLink = extractContactClientId(body)
  const payload = validateContactBody(body, true)

  // client_id-only PATCH is valid (virtual field); RPC bumps version for If-Match.
  if (Object.keys(payload).length === 0 && !clientLink.provided) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  const { data, error } = await db.rpc('update_contact_with_primary_client', {
    p_contact_id: contactId,
    p_org_id: orgId,
    p_expected_version: version,
    p_payload: payload,
    p_client_id: clientLink.clientId,
    p_set_client_id: clientLink.provided,
  })

  if (error) throw mapContactClientRpcError(error, requestId)

  const result = parseContactRpcResult(data, requestId)
  return jsonResponse(
    { data: { ...result.contact, client_id: result.client_id } },
    200,
    requestId,
    { etag: etag(result.contact.version) },
  )
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
