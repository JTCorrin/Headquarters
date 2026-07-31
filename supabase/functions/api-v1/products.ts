import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, ProductRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  isStrictIsoTimestamp,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'
import {
  hashIdempotencyRequest,
  IDEMPOTENCY_KEY_HEADER,
  parseIdempotencyKey,
  sha256Hex,
} from './idempotency.ts'

const SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,sku,name,description,category_id,product_type,unit_name,unit_price_cents,cost_price_cents,currency,tax_rate_id,track_stock,stock_qty,low_stock_at,status,metadata'

const WRITABLE = new Set([
  'sku',
  'name',
  'description',
  'category_id',
  'product_type',
  'unit_name',
  'unit_price_cents',
  'cost_price_cents',
  'currency',
  'tax_rate_id',
  'track_stock',
  'low_stock_at',
  'status',
  'metadata',
])

const TYPES = new Set(['product', 'service'])
const STATUSES = new Set(['active', 'archived'])
const ADJUST_REASONS = new Set(['opening', 'adjustment', 'invoice', 'return', 'void'])

type DatabaseClient = SupabaseClient<Database>
type ProductType = ProductRow['product_type']
type ProductStatus = ProductRow['status']
type Writable = {
  sku?: string
  name?: string
  description?: string | null
  category_id?: string | null
  product_type?: ProductType
  unit_name?: string | null
  unit_price_cents?: number
  cost_price_cents?: number | null
  currency?: string
  tax_rate_id?: string | null
  track_stock?: boolean
  low_stock_at?: number | null
  status?: ProductStatus
  metadata?: Json
}
type Create = Writable & {
  sku: string
  name: string
  product_type: ProductType
  unit_price_cents: number
  currency: string
  track_stock: boolean
  status: ProductStatus
}
type Update = Writable

interface Cursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

function hasAtMostFourDecimals(value: number): boolean {
  return Math.abs(value * 1e4 - Math.round(value * 1e4)) < 1e-6
}

export function validateProductBody(
  body: Record<string, unknown>,
  partial: false,
): Create
export function validateProductBody(
  body: Record<string, unknown>,
  partial: true,
): Update
export function validateProductBody(
  body: Record<string, unknown>,
  partial: boolean,
): Create | Update {
  const fields: Record<string, string> = {}
  const output: Update = {}

  for (const key of Object.keys(body)) {
    if (!WRITABLE.has(key)) fields[key] = 'Field is not writable'
  }
  if ('stock_qty' in body) {
    fields.stock_qty = 'Use POST /api/v1/products/{id}/adjust-stock'
  }

  if (!partial || 'sku' in body) {
    const value = body.sku
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 64) {
      fields.sku = 'Must be a string between 1 and 64 characters'
    } else {
      output.sku = value.trim()
    }
  }

  if (!partial || 'name' in body) {
    const value = body.name
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 160) {
      fields.name = 'Must be a string between 1 and 160 characters'
    } else {
      output.name = value.trim()
    }
  }

  if ('description' in body) {
    const value = body.description
    if (value !== null && typeof value !== 'string') {
      fields.description = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > 20_000) {
      fields.description = 'Must not exceed 20000 characters'
    } else {
      output.description = typeof value === 'string' ? value.trim() || null : null
    }
  }

  if ('unit_name' in body) {
    const value = body.unit_name
    if (value !== null && typeof value !== 'string') {
      fields.unit_name = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > 40) {
      fields.unit_name = 'Must not exceed 40 characters'
    } else {
      output.unit_name = typeof value === 'string' ? value.trim() || null : null
    }
  }

  for (const field of ['category_id', 'tax_rate_id'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (value === null) {
      output[field] = null
    } else {
      try {
        output[field] = parseUuid(typeof value === 'string' ? value : null, field)
      } catch {
        fields[field] = 'Must be a UUID or null'
      }
    }
  }

  if ('product_type' in body) {
    const value = body.product_type
    if (typeof value !== 'string' || !TYPES.has(value)) {
      fields.product_type = 'Must be product or service'
    } else {
      output.product_type = value as ProductType
    }
  } else if (!partial) {
    output.product_type = 'product'
  }

  if ('status' in body) {
    const value = body.status
    if (typeof value !== 'string' || !STATUSES.has(value)) {
      fields.status = 'Must be active or archived'
    } else {
      output.status = value as ProductStatus
    }
  } else if (!partial) {
    output.status = 'active'
  }

  if ('currency' in body) {
    const value = body.currency
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      fields.currency = 'Must be a 3-letter uppercase ISO currency code'
    } else {
      output.currency = value
    }
  } else if (!partial) {
    output.currency = 'GBP'
  }

  if (!partial || 'unit_price_cents' in body) {
    const value = body.unit_price_cents
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      fields.unit_price_cents = 'Must be a non-negative safe integer'
    } else {
      output.unit_price_cents = value
    }
  }

  if ('cost_price_cents' in body) {
    const value = body.cost_price_cents
    if (
      value !== null &&
      (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    ) {
      fields.cost_price_cents = 'Must be a non-negative safe integer or null'
    } else {
      output.cost_price_cents = value as number | null
    }
  }

  if ('track_stock' in body) {
    const value = body.track_stock
    if (typeof value !== 'boolean') {
      fields.track_stock = 'Must be a boolean'
    } else {
      output.track_stock = value
    }
  } else if (!partial) {
    output.track_stock = false
  }

  if ('low_stock_at' in body) {
    const value = body.low_stock_at
    if (
      value !== null &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        !hasAtMostFourDecimals(value) ||
        Math.abs(value) >= 1e10)
    ) {
      fields.low_stock_at = 'Must be a non-negative numeric(14,4) value or null'
    } else {
      output.low_stock_at = value as number | null
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

  const productType = output.product_type
  const trackStock = output.track_stock
  if (productType === 'service' && trackStock === true) {
    fields.track_stock = 'Services cannot track stock'
  }
  if (trackStock === false && 'low_stock_at' in output && output.low_stock_at != null) {
    fields.low_stock_at = 'low_stock_at requires track_stock'
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Product validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }
  return output as Create | Update
}

export function validateAdjustStockBody(body: Record<string, unknown>): {
  quantity_delta: number
  reason: string
  note?: string
  occurred_at?: string
} {
  const fields: Record<string, string> = {}
  const writable = new Set(['quantity_delta', 'reason', 'note', 'occurred_at'])
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  const delta = body.quantity_delta
  if (
    typeof delta !== 'number' ||
    !Number.isFinite(delta) ||
    delta === 0 ||
    !hasAtMostFourDecimals(delta) ||
    Math.abs(delta) >= 1e10
  ) {
    fields.quantity_delta = 'Must be a non-zero numeric(14,4) value'
  }

  const reason = body.reason ?? 'adjustment'
  if (typeof reason !== 'string' || !ADJUST_REASONS.has(reason)) {
    fields.reason = 'Must be opening, adjustment, invoice, return, or void'
  }

  let note: string | undefined
  if ('note' in body) {
    const value = body.note
    if (value !== null && typeof value !== 'string') {
      fields.note = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > 2000) {
      fields.note = 'Must not exceed 2000 characters'
    } else if (typeof value === 'string' && value.trim()) {
      note = value.trim()
    }
  }

  let occurredAt: string | undefined
  if ('occurred_at' in body) {
    const value = body.occurred_at
    if (typeof value !== 'string' || !isStrictIsoTimestamp(value)) {
      fields.occurred_at = 'Must be a strict ISO-8601 timestamp'
    } else {
      occurredAt = value
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Stock adjustment validation failed', fields)
  }

  return {
    quantity_delta: delta as number,
    reason: reason as string,
    ...(note ? { note } : {}),
    ...(occurredAt ? { occurred_at: occurredAt } : {}),
  }
}

function encodeCursor(row: Cursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeProductCursor(value: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<Cursor>
    const createdAt = cursor.created_at
    const id = parseUuid(cursor.id ?? null, 'cursor')
    if (typeof createdAt !== 'string' || !isStrictIsoTimestamp(createdAt)) {
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
  if (
    error.code === '23505' &&
    (error.message?.includes('Idempotency-Key') ||
      error.message?.includes('idempotency'))
  ) {
    return new ApiError(
      409,
      'CONFLICT',
      'Idempotency-Key was reused with a different request payload',
    )
  }
  if (error.code === '55000') {
    return new ApiError(409, 'CONFLICT', 'An identical request is already in progress')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The product conflicts with an existing record')
  }
  if (
    error.code === '23503' ||
    error.code === '23514' ||
    error.code === '22023' ||
    error.code === '22003'
  ) {
    return new ApiError(422, 'VALIDATION_ERROR', 'The product failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Product not found')
  }
  console.error('Product database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The product operation failed')
}

async function findProduct(
  db: DatabaseClient,
  orgId: string,
  productId: string,
  requestId: string,
): Promise<ProductRow> {
  const { data, error } = await db
    .from('products')
    .select(SELECT)
    .eq('org_id', orgId)
    .eq('id', productId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Product not found')
  return data
}

export function handleProducts(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
  userId: string,
): Promise<Response> {
  if (path === '/api/v1/products') {
    if (req.method === 'GET') {
      return (async () => {
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        const status = url.searchParams.get('status')
        if (status && !STATUSES.has(status)) {
          throw new ApiError(400, 'BAD_REQUEST', 'status is invalid')
        }
        let query = db
          .from('products')
          .select(SELECT)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit + 1)
        if (status) query = query.eq('status', status as ProductStatus)
        const cursorValue = url.searchParams.get('cursor')
        if (cursorValue) {
          const cursor = decodeProductCursor(cursorValue)
          query = query.or(
            `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
          )
        }
        const { data, error } = await query
        if (error) throw databaseError(error, requestId)
        const rows = data ?? []
        const hasNextPage = rows.length > limit
        const page = hasNextPage ? rows.slice(0, limit) : rows
        const last = page.at(-1) as Cursor | undefined
        return jsonResponse(
          {
            data: page,
            meta: { next_cursor: hasNextPage && last ? encodeCursor(last) : null },
          },
          200,
          requestId,
        )
      })()
    }
    if (req.method === 'POST') {
      return (async () => {
        const payload = validateProductBody(await jsonBody(req), false)
        const { data, error } = await db
          .from('products')
          .insert(
            { ...payload, org_id: orgId } as Database['public']['Tables']['products']['Insert'],
          )
          .select(SELECT)
          .single()
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data }, 201, requestId, {
          etag: etag(data.version),
          location: `/api/v1/products/${data.id}`,
        })
      })()
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for products')
  }

  const adjustMatch = path.match(
    /^\/api\/v1\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/adjust-stock$/i,
  )
  if (adjustMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for stock adjustment')
    }
    return (async () => {
      const productId = adjustMatch[1]
      const route = `/api/v1/products/${productId}/adjust-stock`
      const rawKey = parseIdempotencyKey(req)
      // Do not preflight via findProduct: RLS hides soft-deleted rows, but retries must
      // still replay stored success. Tenancy is enforced inside the RPC via p_org_id.
      const payload = validateAdjustStockBody(await jsonBody(req))
      const requestHash = await hashIdempotencyRequest(route, {
        product_id: productId,
        ...payload,
      })
      const keyHash = await sha256Hex(rawKey)
      // userId is intentionally unused here: the RPC uses auth.uid() inside one transaction.
      void userId

      const { data, error } = await db.rpc('adjust_product_stock_idempotent', {
        p_product_id: productId,
        p_org_id: orgId,
        p_quantity_delta: payload.quantity_delta,
        p_idempotency_key_hash: keyHash,
        p_request_hash: requestHash,
        p_route: route,
        p_reason: payload.reason,
        p_note: payload.note,
        p_occurred_at: payload.occurred_at,
      })
      if (error) throw databaseError(error, requestId)
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Stock adjustment returned an unexpected payload')
      }
      const envelope = data as {
        replay?: boolean
        response_status?: number
        response_body?: unknown
        response_headers?: Record<string, string>
        product?: ProductRow
        movement?: unknown
      }
      const status = envelope.response_status ?? 200
      const body = envelope.response_body ?? {
        data: { product: envelope.product, movement: envelope.movement },
      }
      const headers = {
        ...(envelope.response_headers ?? {}),
        [IDEMPOTENCY_KEY_HEADER]: rawKey,
      }
      if (!envelope.replay && (!envelope.product || !envelope.movement)) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Stock adjustment returned an incomplete payload')
      }
      return jsonResponse(body, status, requestId, headers)
    })()
  }

  const itemMatch = path.match(
    /^\/api\/v1\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const productId = itemMatch[1]

  if (req.method === 'GET') {
    return findProduct(db, orgId, productId, requestId).then((data) =>
      jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    )
  }
  if (req.method === 'PATCH') {
    return (async () => {
      const version = parseVersion(req)
      const current = await findProduct(db, orgId, productId, requestId)
      if (current.version !== version) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Product version does not match If-Match')
      }
      const payload = validateProductBody(await jsonBody(req), true)
      const { data, error } = await db
        .from('products')
        .update(payload)
        .eq('org_id', orgId)
        .eq('id', productId)
        .eq('version', version)
        .is('deleted_at', null)
        .select(SELECT)
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Product changed during this request')
      }
      return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    })()
  }
  if (req.method === 'DELETE') {
    return (async () => {
      const version = parseVersion(req)
      const current = await findProduct(db, orgId, productId, requestId)
      if (current.version !== version) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Product version does not match If-Match')
      }
      const { data, error } = await db
        .from('products')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', productId)
        .eq('version', version)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Product changed during this request')
      }
      return new Response(null, { status: 204, headers: { 'x-request-id': requestId } })
    })()
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for product')
}
