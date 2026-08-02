import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, VendorRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const VENDOR_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,status,primary_email,phone,website_url,tax_identifier,default_currency,payment_terms_days,notes,metadata'

const WRITABLE_FIELDS = new Set([
  'name',
  'status',
  'primary_email',
  'phone',
  'website_url',
  'tax_identifier',
  'default_currency',
  'payment_terms_days',
  'notes',
  'metadata',
])

const NULLABLE_TEXT_FIELDS = [
  'phone',
  'website_url',
  'tax_identifier',
  'notes',
] as const

const TEXT_LIMITS: Record<(typeof NULLABLE_TEXT_FIELDS)[number], number> = {
  phone: 40,
  website_url: 500,
  tax_identifier: 64,
  notes: 20_000,
}

const STATUSES = new Set(['active', 'inactive', 'archived'])

type DatabaseVendor = SupabaseClient<Database>
type VendorStatus = VendorRow['status']
type VendorWritable = {
  name?: string
  status?: VendorStatus
  website_url?: string | null
  primary_email?: string | null
  phone?: string | null
  tax_identifier?: string | null
  default_currency?: string | null
  payment_terms_days?: number | null
  notes?: string | null
  metadata?: Json
}
type VendorCreate = VendorWritable & { name: string; status: VendorStatus }
type VendorUpdate = VendorWritable

interface VendorCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

export function validateVendorBody(
  body: Record<string, unknown>,
  partial: false,
): VendorCreate
export function validateVendorBody(
  body: Record<string, unknown>,
  partial: true,
): VendorUpdate
export function validateVendorBody(
  body: Record<string, unknown>,
  partial: boolean,
): VendorCreate | VendorUpdate {
  const fields: Record<string, string> = {}
  const output: VendorUpdate = {}

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

  if ('status' in body) {
    const value = body.status
    if (typeof value !== 'string' || !STATUSES.has(value)) {
      fields.status = 'Must be active, inactive, or archived'
    } else {
      output.status = value as VendorStatus
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
      (typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 3650)
    ) {
      fields.payment_terms_days = 'Must be a safe integer between 0 and 3650, or null'
    } else {
      output.payment_terms_days = value as number | null
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
    throw new ApiError(422, 'VALIDATION_ERROR', 'Vendor validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as VendorCreate | VendorUpdate
}

function encodeCursor(vendor: VendorCursor): string {
  return btoa(JSON.stringify({ created_at: vendor.created_at, id: vendor.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeVendorCursor(value: string): VendorCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<VendorCursor>
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
    return new ApiError(412, 'PRECONDITION_FAILED', 'Vendor version does not match If-Match')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The vendor conflicts with an existing record')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', 'The vendor failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Vendor not found')
  }
  console.error('Vendor database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The vendor operation failed')
}

async function listVendors(
  req: Request,
  db: DatabaseVendor,
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
    .from('vendors')
    .select(VENDOR_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (status) {
    query = query.eq('status', status as VendorStatus)
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeVendorCursor(cursorValue)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const vendors = data ?? []
  const hasNextPage = vendors.length > limit
  const page = hasNextPage ? vendors.slice(0, limit) : vendors
  const lastVendor = page.at(-1) as VendorCursor | undefined

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && lastVendor ? encodeCursor(lastVendor) : null,
      },
    },
    200,
    requestId,
  )
}

async function createVendor(
  req: Request,
  db: DatabaseVendor,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateVendorBody(await jsonBody(req), false)
  const { data, error } = await db
    .from('vendors')
    .insert({ ...payload, org_id: orgId })
    .select(VENDOR_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/vendors/${data.id}`,
  })
}

async function findVendor(
  db: DatabaseVendor,
  orgId: string,
  vendorId: string,
  requestId: string,
): Promise<VendorRow> {
  const { data, error } = await db
    .from('vendors')
    .select(VENDOR_SELECT)
    .eq('org_id', orgId)
    .eq('id', vendorId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Vendor not found')
  return data
}

async function getVendor(
  db: DatabaseVendor,
  orgId: string,
  vendorId: string,
  requestId: string,
): Promise<Response> {
  const data = await findVendor(db, orgId, vendorId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateVendor(
  req: Request,
  db: DatabaseVendor,
  orgId: string,
  vendorId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findVendor(db, orgId, vendorId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Vendor version does not match If-Match')
  }

  const payload = validateVendorBody(await jsonBody(req), true)
  const { data, error } = await db
    .from('vendors')
    .update(payload)
    .eq('org_id', orgId)
    .eq('id', vendorId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(VENDOR_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Vendor changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteVendor(
  req: Request,
  db: DatabaseVendor,
  orgId: string,
  vendorId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  // Direct UPDATE ... deleted_at hits RLS 42501 for authenticated callers on
  // staging; mutate through the security-definer RPC (same pattern as contacts).
  const { error } = await db.rpc('soft_delete_vendor', {
    p_vendor_id: vendorId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

export function handleVendors(
  req: Request,
  db: DatabaseVendor,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/vendors') {
    if (req.method === 'GET') return listVendors(req, db, orgId, requestId)
    if (req.method === 'POST') return createVendor(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for vendors')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/vendors\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const vendorId = itemMatch[1]
  if (req.method === 'GET') return getVendor(db, orgId, vendorId, requestId)
  if (req.method === 'PATCH') return updateVendor(req, db, orgId, vendorId, requestId)
  if (req.method === 'DELETE') return deleteVendor(req, db, orgId, vendorId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for vendor')
}
