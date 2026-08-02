import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillLineRow, BillRow, Database, Json } from '../_shared/database.ts'
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
import { assertJsonSafeLineMoney } from './quotes.ts'

const BILL_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,vendor_id,number,internal_reference,status,currency,issue_on,received_on,due_on,scheduled_payment_on,subtotal_cents,discount_cents,tax_cents,total_cents,paid_cents,balance_due_cents,party_snapshot,notes,attachment_document_id,paid_at,voided_at,void_reason'

const HEADER_WRITABLE = new Set([
  'vendor_id',
  'number',
  'internal_reference',
  'currency',
  'issue_on',
  'received_on',
  'due_on',
  'scheduled_payment_on',
  'discount_cents',
  'notes',
  'attachment_document_id',
  'lines',
])

const LINE_WRITABLE = new Set([
  'product_id',
  'description',
  'quantity',
  'unit_price_cents',
  'discount_percent',
  'tax_rate_percent',
  'position',
])

type BillStatus = 'draft' | 'received' | 'scheduled' | 'partial' | 'paid' | 'void'
const BILL_STATUSES: readonly BillStatus[] = [
  'draft',
  'received',
  'scheduled',
  'partial',
  'paid',
  'void',
]

type DatabaseClient = SupabaseClient<Database>

type BillLineInput = {
  product_id?: string | null
  description?: string
  quantity: number
  unit_price_cents?: number
  discount_percent?: number
  tax_rate_percent?: number
  position?: number
}

type BillHeaderInput = {
  vendor_id?: string
  number?: string
  internal_reference?: string | null
  currency?: string
  issue_on?: string | null
  received_on?: string | null
  due_on?: string
  scheduled_payment_on?: string | null
  discount_cents?: number
  notes?: string | null
  attachment_document_id?: string | null
}

type BillCreate = {
  vendor_id: string
  number: string
  currency: string
  due_on?: string
  issue_on?: string | null
  received_on?: string | null
  scheduled_payment_on?: string | null
  internal_reference?: string | null
  discount_cents?: number
  notes?: string | null
  attachment_document_id?: string | null
  lines: BillLineInput[]
}

type BillUpdate = BillHeaderInput & {
  lines?: BillLineInput[]
}

type BillDocument = BillRow & { lines: BillLineRow[] }

interface BillCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
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

function isSafeNonNegativeInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
}

function hasAtMostFourDecimals(value: number): boolean {
  const scaled = value * 1e4
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

function validateBillLine(
  body: Record<string, unknown>,
  index: number,
): BillLineInput {
  const fields: Record<string, string> = {}
  const prefix = `lines.${index}`

  for (const key of Object.keys(body)) {
    if (!LINE_WRITABLE.has(key)) fields[`${prefix}.${key}`] = 'Field is not writable'
  }

  let productId: string | null | undefined
  if ('product_id' in body) {
    const value = body.product_id
    if (value === null) {
      productId = null
    } else if (typeof value !== 'string') {
      fields[`${prefix}.product_id`] = 'Must be a UUID or null'
    } else {
      try {
        productId = parseUuid(value, `${prefix}.product_id`)
      } catch {
        fields[`${prefix}.product_id`] = 'Must be a UUID or null'
      }
    }
  }

  let description: string | undefined
  if ('description' in body) {
    const value = body.description
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
      fields[`${prefix}.description`] = 'Must be a string between 1 and 200 characters'
    } else {
      description = value.trim()
    }
  } else if (productId === null || productId === undefined) {
    if (!('product_id' in body) || body.product_id === null) {
      fields[`${prefix}.description`] = 'Required for free-text lines'
    }
  }

  const quantity = body.quantity
  if (
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !hasAtMostFourDecimals(quantity) ||
    quantity >= 1e10
  ) {
    fields[`${prefix}.quantity`] = 'Must be a positive numeric(14,4) value'
  }

  let unitPrice: number | undefined
  if ('unit_price_cents' in body) {
    const value = body.unit_price_cents
    if (typeof value !== 'number' || !isSafeNonNegativeInt(value)) {
      fields[`${prefix}.unit_price_cents`] = 'Must be a non-negative integer'
    } else {
      unitPrice = value
    }
  } else if (productId === null || !('product_id' in body)) {
    fields[`${prefix}.unit_price_cents`] = 'Required for free-text lines'
  }

  if (
    typeof quantity === 'number' &&
    unitPrice !== undefined &&
    !assertJsonSafeLineMoney(quantity, unitPrice)
  ) {
    fields[`${prefix}.unit_price_cents`] =
      'quantity × unit_price_cents exceeds JSON-safe integer range'
  }

  let discountPercent = 0
  if ('discount_percent' in body) {
    const value = body.discount_percent
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100 ||
      !hasAtMostFourDecimals(value)
    ) {
      fields[`${prefix}.discount_percent`] = 'Must be a number between 0 and 100'
    } else {
      discountPercent = value
    }
  }

  let taxRate: number | undefined
  if ('tax_rate_percent' in body) {
    const value = body.tax_rate_percent
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100 ||
      !hasAtMostFourDecimals(value)
    ) {
      fields[`${prefix}.tax_rate_percent`] = 'Must be a number between 0 and 100'
    } else {
      taxRate = value
    }
  }

  let position: number | undefined
  if ('position' in body) {
    const value = body.position
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      fields[`${prefix}.position`] = 'Must be a non-negative integer'
    } else {
      position = value
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Bill line validation failed', fields)
  }

  return {
    quantity: quantity as number,
    discount_percent: discountPercent,
    ...(productId !== undefined ? { product_id: productId } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(unitPrice !== undefined ? { unit_price_cents: unitPrice } : {}),
    ...(taxRate !== undefined ? { tax_rate_percent: taxRate } : {}),
    ...(position !== undefined ? { position } : {}),
  }
}

function validateLines(value: unknown): BillLineInput[] {
  if (!Array.isArray(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Bill validation failed', {
      lines: 'Must be an array',
    })
  }
  if (value.length > 200) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Bill validation failed', {
      lines: 'Must not exceed 200 lines',
    })
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Bill validation failed', {
        [`lines.${index}`]: 'Must be an object',
      })
    }
    return validateBillLine(item as Record<string, unknown>, index)
  })
}

export function validateBillBody(
  body: Record<string, unknown>,
  partial: false,
  options?: { defaultCurrency?: string },
): BillCreate
export function validateBillBody(
  body: Record<string, unknown>,
  partial: true,
  options?: { defaultCurrency?: string },
): BillUpdate
export function validateBillBody(
  body: Record<string, unknown>,
  partial: boolean,
  options: { defaultCurrency?: string } = {},
): BillCreate | BillUpdate {
  const fields: Record<string, string> = {}
  const output: BillUpdate = {}
  const defaultCurrency = options.defaultCurrency ?? 'GBP'

  for (const key of Object.keys(body)) {
    if (!HEADER_WRITABLE.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'vendor_id' in body) {
    const value = body.vendor_id
    if (value === null || typeof value !== 'string') {
      fields.vendor_id = 'Must be a UUID'
    } else {
      try {
        output.vendor_id = parseUuid(value, 'vendor_id')
      } catch {
        fields.vendor_id = 'Must be a UUID'
      }
    }
  }

  if (!partial || 'number' in body) {
    const value = body.number
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 64) {
      fields.number = 'Must be a string between 1 and 64 characters'
    } else {
      output.number = value.trim()
    }
  }

  if ('internal_reference' in body) {
    const value = body.internal_reference
    if (value !== null && typeof value !== 'string') {
      fields.internal_reference = 'Must be a string or null'
    } else if (
      typeof value === 'string' && (value.trim().length < 1 || value.trim().length > 64)
    ) {
      fields.internal_reference = 'Must be between 1 and 64 characters, or null'
    } else {
      output.internal_reference = typeof value === 'string' ? value.trim() : null
    }
  }

  if (!partial || 'currency' in body) {
    const value = !partial ? (body.currency ?? defaultCurrency) : body.currency
    if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
      fields.currency = 'Must be a 3-letter ISO currency code'
    } else {
      output.currency = value.toUpperCase()
    }
  }

  for (const field of ['issue_on', 'received_on', 'scheduled_payment_on'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (value === null) {
      output[field] = null
    } else if (typeof value !== 'string' || !isValidDateOnly(value)) {
      fields[field] = 'Must be a YYYY-MM-DD date or null'
    } else {
      output[field] = value
    }
  }

  if ('due_on' in body) {
    const value = body.due_on
    if (typeof value !== 'string' || !isValidDateOnly(value)) {
      fields.due_on = 'Must be a YYYY-MM-DD date'
    } else {
      output.due_on = value
    }
  }

  if ('discount_cents' in body) {
    const value = body.discount_cents
    if (typeof value !== 'number' || !isSafeNonNegativeInt(value)) {
      fields.discount_cents = 'Must be a non-negative integer'
    } else {
      output.discount_cents = value
    }
  }

  if ('notes' in body) {
    const value = body.notes
    if (value !== null && typeof value !== 'string') {
      fields.notes = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > 20_000) {
      fields.notes = 'Must not exceed 20000 characters'
    } else {
      output.notes = typeof value === 'string' ? value.trim() || null : null
    }
  }

  if ('attachment_document_id' in body) {
    const value = body.attachment_document_id
    if (value === null) {
      output.attachment_document_id = null
    } else if (typeof value !== 'string') {
      fields.attachment_document_id = 'Must be a UUID or null'
    } else {
      try {
        output.attachment_document_id = parseUuid(value, 'attachment_document_id')
      } catch {
        fields.attachment_document_id = 'Must be a UUID or null'
      }
    }
  }

  let lines: BillLineInput[] | undefined
  if ('lines' in body) {
    try {
      lines = validateLines(body.lines)
      output.lines = lines
    } catch (error) {
      if (error instanceof ApiError) throw error
      fields.lines = 'Invalid lines payload'
    }
  } else if (!partial) {
    lines = []
    output.lines = lines
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Bill validation failed', fields)
  }

  if (!partial) {
    return {
      vendor_id: output.vendor_id as string,
      number: output.number as string,
      currency: output.currency as string,
      lines: output.lines ?? [],
      ...(output.due_on !== undefined ? { due_on: output.due_on } : {}),
      ...(output.issue_on !== undefined ? { issue_on: output.issue_on } : {}),
      ...(output.received_on !== undefined ? { received_on: output.received_on } : {}),
      ...(output.scheduled_payment_on !== undefined
        ? { scheduled_payment_on: output.scheduled_payment_on }
        : {}),
      ...(output.internal_reference !== undefined
        ? { internal_reference: output.internal_reference }
        : {}),
      ...(output.discount_cents !== undefined ? { discount_cents: output.discount_cents } : {}),
      ...(output.notes !== undefined ? { notes: output.notes } : {}),
      ...(output.attachment_document_id !== undefined
        ? { attachment_document_id: output.attachment_document_id }
        : {}),
    }
  }

  if (Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one field is required', {
      body: 'At least one field is required',
    })
  }

  return output
}

function validateVoidBody(body: Record<string, unknown>): string {
  const value = body.void_reason
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 2000) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Bill void validation failed', {
      void_reason: 'Must be a string between 1 and 2000 characters',
    })
  }
  return value.trim()
}

function encodeCursor(row: BillCursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeBillCursor(value: string): BillCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<BillCursor>
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
  if (error.message?.toLowerCase().includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Bill version does not match If-Match')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The bill conflicts with an existing record')
  }
  if (
    error.code === '23503' ||
    error.code === '23514' ||
    error.code === '22023' ||
    error.code === '22003'
  ) {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      error.message || 'The bill failed a database constraint',
    )
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', error.message || 'Bill not found')
  }
  console.error('Bill database operation failed', {
    request_id: requestId,
    code: error.code,
    message: error.message,
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Bill operation failed')
}

function asBillDocument(data: Json): BillDocument {
  const payload = data as { bill?: BillRow; lines?: BillLineRow[] }
  if (!payload.bill) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Bill RPC returned an incomplete payload')
  }
  return {
    ...payload.bill,
    lines: Array.isArray(payload.lines) ? payload.lines : [],
  }
}

function toRpcPayload(input: BillHeaderInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'lines') continue
    if (value !== undefined) payload[key] = value
  }
  return payload
}

async function listBills(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const status = url.searchParams.get('status')
  if (status !== null && !BILL_STATUSES.includes(status as BillStatus)) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is not supported', {
      status: 'Must be one of draft, received, scheduled, partial, paid, void',
    })
  }
  const cursorValue = url.searchParams.get('cursor')
  const cursor = cursorValue ? decodeBillCursor(cursorValue) : null

  let query = db
    .from('bills')
    .select(BILL_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (status) query = query.eq('status', status as BillStatus)
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const rows = data ?? []
  const hasNextPage = rows.length > limit
  const page = hasNextPage ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

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

async function createBill(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data: organisation, error: orgError } = await db
    .from('organisations')
    .select('default_currency')
    .eq('id', orgId)
    .is('deleted_at', null)
    .maybeSingle()
  if (orgError) throw databaseError(orgError, requestId)
  if (!organisation) throw new ApiError(404, 'NOT_FOUND', 'Organisation not found')

  const body = await jsonBody(req)
  const validated = validateBillBody(body, false, {
    defaultCurrency: organisation.default_currency,
  })
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('create_bill_draft', {
    p_org_id: orgId,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines as unknown as Json,
  })

  if (error) throw databaseError(error, requestId)
  const document = asBillDocument(data)

  return jsonResponse({ data: document }, 201, requestId, {
    etag: etag(document.version),
    location: `/api/v1/bills/${document.id}`,
  })
}

async function findBillDocument(
  db: DatabaseClient,
  orgId: string,
  billId: string,
  requestId: string,
): Promise<BillDocument> {
  // Single transactional RPC: FOR SHARE on the header, then lines, so a concurrent
  // save cannot return a stale ETag with replaced lines.
  const { data, error } = await db.rpc('get_bill_document', {
    p_bill_id: billId,
    p_org_id: orgId,
  })

  if (error) throw databaseError(error, requestId)
  return asBillDocument(data)
}

async function getBill(
  db: DatabaseClient,
  orgId: string,
  billId: string,
  requestId: string,
): Promise<Response> {
  const data = await findBillDocument(db, orgId, billId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateBill(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  billId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findBillDocument(db, orgId, billId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Bill version does not match If-Match')
  }
  if (current.status !== 'draft') {
    throw new ApiError(409, 'CONFLICT', 'Only draft bills can be edited in this release')
  }

  const validated = validateBillBody(await jsonBody(req), true)
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('save_bill_draft', {
    p_bill_id: billId,
    p_org_id: orgId,
    p_expected_version: version,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines === undefined ? null : lines as unknown as Json,
  })

  if (error) throw databaseError(error, requestId)
  const document = asBillDocument(data)

  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

async function deleteBill(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  billId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findBillDocument(db, orgId, billId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Bill version does not match If-Match')
  }

  const { error } = await db.rpc('soft_delete_bill_draft', {
    p_bill_id: billId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function receiveBillRoute(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  billId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)

  const { data, error } = await db.rpc('receive_bill', {
    p_bill_id: billId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)
  const document = asBillDocument(data)

  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

async function voidBillRoute(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  billId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const voidReason = validateVoidBody(await jsonBody(req))

  const { data, error } = await db.rpc('void_bill', {
    p_bill_id: billId,
    p_org_id: orgId,
    p_expected_version: version,
    p_void_reason: voidReason,
  })

  if (error) throw databaseError(error, requestId)
  const document = asBillDocument(data)

  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

export function handleBills(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/bills') {
    if (req.method === 'GET') return listBills(req, db, orgId, requestId)
    if (req.method === 'POST') return createBill(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for bills')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/bills\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(receive|void))?$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const billId = itemMatch[1]
  const action = itemMatch[2]

  if (action === 'receive') {
    if (req.method === 'POST') return receiveBillRoute(req, db, orgId, billId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for bill receive')
  }

  if (action === 'void') {
    if (req.method === 'POST') return voidBillRoute(req, db, orgId, billId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for bill void')
  }

  if (req.method === 'GET') return getBill(db, orgId, billId, requestId)
  if (req.method === 'PATCH') return updateBill(req, db, orgId, billId, requestId)
  if (req.method === 'DELETE') return deleteBill(req, db, orgId, billId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for bill')
}
