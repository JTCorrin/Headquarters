import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, QuoteLineRow, QuoteRow } from '../_shared/database.ts'
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

const QUOTE_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,number,title,client_id,lead_id,contact_id,owner_membership_id,status,currency,issue_on,valid_until,subtotal_cents,discount_cents,tax_cents,total_cents,party_snapshot,terms,notes,internal_notes,sent_at,viewed_at,accepted_at,rejected_at,converted_invoice_id'

type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'void'
const QUOTE_STATUSES: readonly QuoteStatus[] = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'void',
]

const HEADER_WRITABLE = new Set([
  'title',
  'client_id',
  'lead_id',
  'contact_id',
  'owner_membership_id',
  'currency',
  'issue_on',
  'valid_until',
  'discount_cents',
  'terms',
  'notes',
  'internal_notes',
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

type DatabaseClient = SupabaseClient<Database>

type QuoteLineInput = {
  product_id?: string | null
  description?: string
  quantity: number
  unit_price_cents?: number
  discount_percent?: number
  tax_rate_percent?: number
  position?: number
}

type QuoteHeaderInput = {
  title?: string
  client_id?: string | null
  lead_id?: string | null
  contact_id?: string | null
  owner_membership_id?: string | null
  currency?: string
  issue_on?: string
  valid_until?: string | null
  discount_cents?: number
  terms?: string | null
  notes?: string | null
  internal_notes?: string | null
}

type QuoteCreate = QuoteHeaderInput & {
  title: string
  currency: string
  lines: QuoteLineInput[]
}

type QuoteUpdate = QuoteHeaderInput & {
  lines?: QuoteLineInput[]
}

type QuoteDocument = QuoteRow & { lines: QuoteLineRow[] }

interface QuoteCursor {
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

/** Reject quantity × unit_price products that would round in JSON number encoding. */
export function assertJsonSafeLineMoney(
  quantity: number,
  unitPriceCents: number,
): boolean {
  if (!Number.isFinite(quantity) || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
    return false
  }
  if (unitPriceCents === 0) return true
  return quantity <= Number.MAX_SAFE_INTEGER / unitPriceCents
}

function validateQuoteLine(
  body: Record<string, unknown>,
  index: number,
): QuoteLineInput {
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
    // Free-text lines require description; product lines may inherit name in RPC.
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
    throw new ApiError(422, 'VALIDATION_ERROR', 'Quote line validation failed', fields)
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

function validateLines(value: unknown): QuoteLineInput[] {
  if (!Array.isArray(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Quote validation failed', {
      lines: 'Must be an array',
    })
  }
  if (value.length > 200) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Quote validation failed', {
      lines: 'Must not exceed 200 lines',
    })
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Quote validation failed', {
        [`lines.${index}`]: 'Must be an object',
      })
    }
    return validateQuoteLine(item as Record<string, unknown>, index)
  })
}

export function validateQuoteBody(
  body: Record<string, unknown>,
  partial: false,
  options?: { defaultCurrency?: string },
): QuoteCreate
export function validateQuoteBody(
  body: Record<string, unknown>,
  partial: true,
  options?: { defaultCurrency?: string },
): QuoteUpdate
export function validateQuoteBody(
  body: Record<string, unknown>,
  partial: boolean,
  options: { defaultCurrency?: string } = {},
): QuoteCreate | QuoteUpdate {
  const fields: Record<string, string> = {}
  const output: QuoteUpdate = {}
  const defaultCurrency = options.defaultCurrency ?? 'GBP'

  for (const key of Object.keys(body)) {
    if (!HEADER_WRITABLE.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'title' in body) {
    const value = body.title
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 160) {
      fields.title = 'Must be a string between 1 and 160 characters'
    } else {
      output.title = value.trim()
    }
  }

  for (const field of ['client_id', 'lead_id', 'contact_id', 'owner_membership_id'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (value === null) {
      output[field] = null
    } else if (typeof value !== 'string') {
      fields[field] = 'Must be a UUID or null'
    } else {
      try {
        output[field] = parseUuid(value, field)
      } catch {
        fields[field] = 'Must be a UUID or null'
      }
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

  if ('issue_on' in body) {
    const value = body.issue_on
    if (typeof value !== 'string' || !isValidDateOnly(value)) {
      fields.issue_on = 'Must be a YYYY-MM-DD date'
    } else {
      output.issue_on = value
    }
  }

  if ('valid_until' in body) {
    const value = body.valid_until
    if (value === null) {
      output.valid_until = null
    } else if (typeof value !== 'string' || !isValidDateOnly(value)) {
      fields.valid_until = 'Must be a YYYY-MM-DD date or null'
    } else {
      output.valid_until = value
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

  for (const field of ['terms', 'notes', 'internal_notes'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    const limit = field === 'terms' ? 20_000 : 20_000
    if (value !== null && typeof value !== 'string') {
      fields[field] = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > limit) {
      fields[field] = `Must not exceed ${limit} characters`
    } else {
      output[field] = typeof value === 'string' ? value.trim() || null : null
    }
  }

  let lines: QuoteLineInput[] | undefined
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

  if (!partial) {
    const clientId = output.client_id
    const leadId = output.lead_id
    if (clientId == null && leadId == null) {
      fields.client_id = 'Provide client_id or lead_id'
      fields.lead_id = 'Provide client_id or lead_id'
    }
  } else if ('client_id' in body || 'lead_id' in body) {
    // Cross-field check deferred to RPC when only one side is patched.
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Quote validation failed', fields)
  }

  if (!partial) {
    return {
      title: output.title as string,
      currency: output.currency as string,
      lines: output.lines ?? [],
      ...(output.client_id !== undefined ? { client_id: output.client_id } : {}),
      ...(output.lead_id !== undefined ? { lead_id: output.lead_id } : {}),
      ...(output.contact_id !== undefined ? { contact_id: output.contact_id } : {}),
      ...(output.owner_membership_id !== undefined
        ? { owner_membership_id: output.owner_membership_id }
        : {}),
      ...(output.issue_on !== undefined ? { issue_on: output.issue_on } : {}),
      ...(output.valid_until !== undefined ? { valid_until: output.valid_until } : {}),
      ...(output.discount_cents !== undefined ? { discount_cents: output.discount_cents } : {}),
      ...(output.terms !== undefined ? { terms: output.terms } : {}),
      ...(output.notes !== undefined ? { notes: output.notes } : {}),
      ...(output.internal_notes !== undefined ? { internal_notes: output.internal_notes } : {}),
    }
  }

  if (Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one field is required', {
      body: 'At least one field is required',
    })
  }

  return output
}

function encodeCursor(row: QuoteCursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeQuoteCursor(value: string): QuoteCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<QuoteCursor>
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

/** Validate optional `status` list filter against the quotes.status check enum. */
export function parseQuoteListStatus(value: string | null): QuoteStatus | null {
  if (value === null) return null
  if (!QUOTE_STATUSES.includes(value as QuoteStatus)) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is not supported', {
      status: 'Must be one of draft, sent, accepted, rejected, expired, void',
    })
  }
  return value as QuoteStatus
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  if (error.message?.toLowerCase().includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Quote version does not match If-Match')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The quote conflicts with an existing record')
  }
  if (error.code === '22023') {
    // Deliberate RAISE from our own RPCs; the message is user-facing.
    return new ApiError(422, 'VALIDATION_ERROR', error.message || 'Quote validation failed')
  }
  if (error.code === '23503' || error.code === '23514' || error.code === '22003') {
    // Postgres-generated constraint messages leak schema details; keep generic.
    return new ApiError(422, 'VALIDATION_ERROR', 'The quote failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Quote not found')
  }
  console.error('Quote database operation failed', {
    request_id: requestId,
    code: error.code,
    message: error.message,
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Quote operation failed')
}

function asQuoteDocument(data: Json): QuoteDocument {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Quote RPC returned an unexpected payload')
  }
  const payload = data as { quote?: QuoteRow; lines?: QuoteLineRow[] }
  if (!payload.quote) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Quote RPC returned an incomplete payload')
  }
  return {
    ...payload.quote,
    lines: Array.isArray(payload.lines) ? payload.lines : [],
  }
}

function toRpcPayload(input: QuoteHeaderInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'lines') continue
    if (value !== undefined) payload[key] = value
  }
  return payload
}

async function listQuotes(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const status = parseQuoteListStatus(url.searchParams.get('status'))
  const clientId = url.searchParams.get('client_id')
  const cursorValue = url.searchParams.get('cursor')
  const cursor = cursorValue ? decodeQuoteCursor(cursorValue) : null

  let query = db
    .from('quotes')
    .select(QUOTE_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (status) query = query.eq('status', status)
  if (clientId) query = query.eq('client_id', parseUuid(clientId, 'client_id'))
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

async function createQuote(
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
  const validated = validateQuoteBody(body, false, {
    defaultCurrency: organisation.default_currency,
  })
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('create_quote_draft', {
    p_org_id: orgId,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines as unknown as Json,
  })

  if (error) throw databaseError(error, requestId)
  const document = asQuoteDocument(data)

  return jsonResponse({ data: document }, 201, requestId, {
    etag: etag(document.version),
    location: `/api/v1/quotes/${document.id}`,
  })
}

async function findQuoteDocument(
  db: DatabaseClient,
  orgId: string,
  quoteId: string,
  requestId: string,
): Promise<QuoteDocument> {
  // Single transactional RPC: FOR SHARE on the header, then lines, so a concurrent
  // save cannot return a stale ETag with replaced lines.
  const { data, error } = await db.rpc('get_quote_document', {
    p_quote_id: quoteId,
    p_org_id: orgId,
  })

  if (error) throw databaseError(error, requestId)
  return asQuoteDocument(data)
}

async function getQuote(
  db: DatabaseClient,
  orgId: string,
  quoteId: string,
  requestId: string,
): Promise<Response> {
  const data = await findQuoteDocument(db, orgId, quoteId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateQuote(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  quoteId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findQuoteDocument(db, orgId, quoteId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Quote version does not match If-Match')
  }
  if (current.status !== 'draft') {
    throw new ApiError(409, 'CONFLICT', 'Only draft quotes can be edited in this release')
  }

  const validated = validateQuoteBody(await jsonBody(req), true)
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('save_quote_draft', {
    p_quote_id: quoteId,
    p_org_id: orgId,
    p_expected_version: version,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines === undefined ? null : lines as unknown as Json,
  })

  if (error) throw databaseError(error, requestId)
  const document = asQuoteDocument(data)

  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

async function deleteQuote(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  quoteId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findQuoteDocument(db, orgId, quoteId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Quote version does not match If-Match')
  }

  const { error } = await db.rpc('soft_delete_quote_draft', {
    p_quote_id: quoteId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function acceptQuoteRoute(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  quoteId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)

  const { data, error } = await db.rpc('accept_quote', {
    p_quote_id: quoteId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) {
    if (error.message?.toLowerCase().includes('version conflict')) {
      throw new ApiError(412, 'PRECONDITION_FAILED', 'Quote version does not match If-Match')
    }
    if (error.code === 'P0002') {
      throw new ApiError(404, 'NOT_FOUND', error.message || 'Quote not found')
    }
    if (error.code === '42501') {
      throw new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
    }
    if (error.code === '22023') {
      // Deliberate RAISE from our own RPCs; the message is user-facing.
      throw new ApiError(422, 'VALIDATION_ERROR', error.message || 'Quote validation failed')
    }
    if (error.code === '23503' || error.code === '23514') {
      // Postgres-generated constraint messages leak schema details; keep generic.
      throw new ApiError(422, 'VALIDATION_ERROR', 'The quote failed a database constraint')
    }
    console.error('Quote accept failed', {
      request_id: requestId,
      code: error.code,
      message: error.message,
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Quote accept failed')
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Quote RPC returned an unexpected payload')
  }
  const payload = data as { quote?: QuoteRow; lines?: QuoteLineRow[] }
  if (!payload.quote) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Quote RPC returned an incomplete payload')
  }
  const document = {
    ...payload.quote,
    lines: Array.isArray(payload.lines) ? payload.lines : [],
  }

  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

export function handleQuotes(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/quotes') {
    if (req.method === 'GET') return listQuotes(req, db, orgId, requestId)
    if (req.method === 'POST') return createQuote(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for quotes')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/quotes\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(accept))?$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const quoteId = itemMatch[1]
  const action = itemMatch[2]

  if (action === 'accept') {
    if (req.method === 'POST') return acceptQuoteRoute(req, db, orgId, quoteId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for quote accept')
  }

  if (req.method === 'GET') return getQuote(db, orgId, quoteId, requestId)
  if (req.method === 'PATCH') return updateQuote(req, db, orgId, quoteId, requestId)
  if (req.method === 'DELETE') return deleteQuote(req, db, orgId, quoteId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for quote')
}
