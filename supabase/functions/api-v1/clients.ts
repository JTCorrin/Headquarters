import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientRow, Database, Json } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const CLIENT_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,status,website_url,industry,primary_email,phone,tax_identifier,registration_number,default_currency,payment_terms_days,owner_membership_id,converted_from_lead_id,renewal_on,notes,metadata'

const WRITABLE_FIELDS = new Set([
  'name',
  'status',
  'website_url',
  'industry',
  'primary_email',
  'phone',
  'tax_identifier',
  'registration_number',
  'default_currency',
  'payment_terms_days',
  'owner_membership_id',
  'renewal_on',
  'notes',
  'metadata',
])

const NULLABLE_TEXT_FIELDS = [
  'website_url',
  'industry',
  'primary_email',
  'phone',
  'tax_identifier',
  'registration_number',
  'notes',
] as const

const TEXT_LIMITS: Record<(typeof NULLABLE_TEXT_FIELDS)[number], number> = {
  website_url: 2000,
  industry: 120,
  primary_email: 320,
  phone: 64,
  tax_identifier: 120,
  registration_number: 120,
  notes: 20_000,
}

const STATUSES = new Set(['prospect', 'active', 'on_hold', 'inactive', 'archived'])

type DatabaseClient = SupabaseClient<Database>
type ClientStatus = ClientRow['status']
type ClientWritable = {
  name?: string
  status?: ClientStatus
  website_url?: string | null
  industry?: string | null
  primary_email?: string | null
  phone?: string | null
  tax_identifier?: string | null
  registration_number?: string | null
  default_currency?: string | null
  payment_terms_days?: number | null
  owner_membership_id?: string | null
  renewal_on?: string | null
  notes?: string | null
  metadata?: Json
}
type ClientCreate = ClientWritable & { name: string; status: ClientStatus }
type ClientUpdate = ClientWritable

interface ClientCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

export function validateClientBody(
  body: Record<string, unknown>,
  partial: false,
): ClientCreate
export function validateClientBody(
  body: Record<string, unknown>,
  partial: true,
): ClientUpdate
export function validateClientBody(
  body: Record<string, unknown>,
  partial: boolean,
): ClientCreate | ClientUpdate {
  const fields: Record<string, string> = {}
  const output: ClientUpdate = {}

  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'name' in body) {
    const value = body.name
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
      fields.name = 'Must be a string between 1 and 200 characters'
    } else {
      output.name = value.trim()
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

  if ('status' in body) {
    const value = body.status
    if (typeof value !== 'string' || !STATUSES.has(value)) {
      fields.status = 'Must be prospect, active, on_hold, inactive, or archived'
    } else {
      output.status = value as ClientStatus
    }
  } else if (!partial) {
    output.status = 'active'
  }

  if ('default_currency' in body) {
    const value = body.default_currency
    if (value !== null && (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))) {
      fields.default_currency = 'Must be a 3-letter uppercase ISO currency code or null'
    } else {
      output.default_currency = value as string | null
    }
  }

  if ('payment_terms_days' in body) {
    const value = body.payment_terms_days
    if (
      value !== null &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3650)
    ) {
      fields.payment_terms_days = 'Must be an integer between 0 and 3650, or null'
    } else {
      output.payment_terms_days = value as number | null
    }
  }

  if ('renewal_on' in body) {
    const value = body.renewal_on
    if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      fields.renewal_on = 'Must be a YYYY-MM-DD date or null'
    } else {
      output.renewal_on = value as string | null
    }
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
    throw new ApiError(422, 'VALIDATION_ERROR', 'Client validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as ClientCreate | ClientUpdate
}

function encodeCursor(client: ClientCursor): string {
  return btoa(JSON.stringify({ created_at: client.created_at, id: client.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeClientCursor(value: string): ClientCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<ClientCursor>
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
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The client conflicts with an existing record')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', 'The client failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  console.error('Client database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The client operation failed')
}

async function listClients(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const status = url.searchParams.get('status')
  if (status && !STATUSES.has(status)) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is invalid')
  }

  let query = db
    .from('clients')
    .select(CLIENT_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (status) {
    query = query.eq('status', status as ClientStatus)
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeClientCursor(cursorValue)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const clients = data ?? []
  const hasNextPage = clients.length > limit
  const page = hasNextPage ? clients.slice(0, limit) : clients
  const lastClient = page.at(-1) as ClientCursor | undefined

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && lastClient ? encodeCursor(lastClient) : null,
      },
    },
    200,
    requestId,
  )
}

async function createClient(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateClientBody(await jsonBody(req), false)
  const { data, error } = await db
    .from('clients')
    .insert({ ...payload, org_id: orgId })
    .select(CLIENT_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/clients/${data.id}`,
  })
}

async function findClient(
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<ClientRow> {
  const { data, error } = await db
    .from('clients')
    .select(CLIENT_SELECT)
    .eq('org_id', orgId)
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Client not found')
  return data
}

async function getClient(
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<Response> {
  const data = await findClient(db, orgId, clientId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateClient(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findClient(db, orgId, clientId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Client version does not match If-Match')
  }

  const payload = validateClientBody(await jsonBody(req), true)
  const { data, error } = await db
    .from('clients')
    .update(payload)
    .eq('org_id', orgId)
    .eq('id', clientId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(CLIENT_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Client changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteClient(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findClient(db, orgId, clientId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Client version does not match If-Match')
  }

  const { data, error } = await db
    .from('clients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', clientId)
    .eq('version', version)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Client changed during this request')
  }

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

export function handleClients(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/clients') {
    if (req.method === 'GET') return listClients(req, db, orgId, requestId)
    if (req.method === 'POST') return createClient(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for clients')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/clients\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const clientId = itemMatch[1]
  if (req.method === 'GET') return getClient(db, orgId, clientId, requestId)
  if (req.method === 'PATCH') return updateClient(req, db, orgId, clientId, requestId)
  if (req.method === 'DELETE') return deleteClient(req, db, orgId, clientId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for client')
}
