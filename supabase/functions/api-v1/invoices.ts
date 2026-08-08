import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, InvoiceLineRow, InvoiceRow, Json } from '../_shared/database.ts'
import { dispatchPlaybookTriggersSafe } from '../_shared/playbook-dispatch.ts'
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
  idempotencyConflictError,
  type IdempotencyEnvelope,
  parseIdempotencyKey,
  sha256Hex,
} from './idempotency.ts'
import { assertJsonSafeLineMoney } from './quotes.ts'
import { type RecipientInput, type RecipientRow, validateRecipientsField } from './recipients.ts'

const INVOICE_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,number,client_id,contact_id,quote_id,owner_membership_id,source,recurring_run_id,billing_period_start,billing_period_end,status,currency,issue_on,due_on,purchase_order_number,subtotal_cents,discount_cents,tax_cents,total_cents,paid_cents,balance_due_cents,party_snapshot,payment_terms,notes,internal_notes,sent_at,viewed_at,paid_at,voided_at,void_reason'

const HEADER_WRITABLE = new Set([
  'client_id',
  'contact_id',
  'owner_membership_id',
  'currency',
  'issue_on',
  'due_on',
  'purchase_order_number',
  'discount_cents',
  'payment_terms',
  'notes',
  'internal_notes',
  'lines',
  'recipients',
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

type InvoiceStatus = 'draft' | 'partial' | 'paid' | 'sent' | 'void'
const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'partial', 'paid', 'void']

type DatabaseClient = SupabaseClient<Database>

type InvoiceLineInput = {
  product_id?: string | null
  description?: string
  quantity: number
  unit_price_cents?: number
  discount_percent?: number
  tax_rate_percent?: number
  position?: number
}

type InvoiceHeaderInput = {
  client_id?: string
  contact_id?: string | null
  owner_membership_id?: string | null
  currency?: string
  issue_on?: string
  due_on?: string
  purchase_order_number?: string | null
  discount_cents?: number
  payment_terms?: string | null
  notes?: string | null
  internal_notes?: string | null
  recipients?: RecipientInput[]
}

type InvoiceCreate = InvoiceHeaderInput & {
  client_id: string
  currency: string
  lines: InvoiceLineInput[]
}

type InvoiceUpdate = InvoiceHeaderInput & {
  lines?: InvoiceLineInput[]
}

type InvoiceDocument = InvoiceRow & { lines: InvoiceLineRow[]; recipients: RecipientRow[] }

interface InvoiceCursor {
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

function validateInvoiceLine(
  body: Record<string, unknown>,
  index: number,
): InvoiceLineInput {
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
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invoice line validation failed', fields)
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

function validateLines(value: unknown): InvoiceLineInput[] {
  if (!Array.isArray(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invoice validation failed', {
      lines: 'Must be an array',
    })
  }
  if (value.length > 200) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invoice validation failed', {
      lines: 'Must not exceed 200 lines',
    })
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Invoice validation failed', {
        [`lines.${index}`]: 'Must be an object',
      })
    }
    return validateInvoiceLine(item as Record<string, unknown>, index)
  })
}

export function validateInvoiceBody(
  body: Record<string, unknown>,
  partial: false,
  options?: { defaultCurrency?: string },
): InvoiceCreate
export function validateInvoiceBody(
  body: Record<string, unknown>,
  partial: true,
  options?: { defaultCurrency?: string },
): InvoiceUpdate
export function validateInvoiceBody(
  body: Record<string, unknown>,
  partial: boolean,
  options: { defaultCurrency?: string } = {},
): InvoiceCreate | InvoiceUpdate {
  const fields: Record<string, string> = {}
  const output: InvoiceUpdate = {}
  const defaultCurrency = options.defaultCurrency ?? 'GBP'

  for (const key of Object.keys(body)) {
    if (!HEADER_WRITABLE.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'client_id' in body) {
    const value = body.client_id
    if (value === null || typeof value !== 'string') {
      fields.client_id = 'Must be a UUID'
    } else {
      try {
        output.client_id = parseUuid(value, 'client_id')
      } catch {
        fields.client_id = 'Must be a UUID'
      }
    }
  }

  for (const field of ['contact_id', 'owner_membership_id'] as const) {
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

  if ('due_on' in body) {
    const value = body.due_on
    if (typeof value !== 'string' || !isValidDateOnly(value)) {
      fields.due_on = 'Must be a YYYY-MM-DD date'
    } else {
      output.due_on = value
    }
  }

  if ('purchase_order_number' in body) {
    const value = body.purchase_order_number
    if (value !== null && typeof value !== 'string') {
      fields.purchase_order_number = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > 200) {
      fields.purchase_order_number = 'Must not exceed 200 characters'
    } else {
      output.purchase_order_number = typeof value === 'string' ? value.trim() || null : null
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

  for (const field of ['payment_terms', 'notes', 'internal_notes'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    const limit = 20_000
    if (value !== null && typeof value !== 'string') {
      fields[field] = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > limit) {
      fields[field] = `Must not exceed ${limit} characters`
    } else {
      output[field] = typeof value === 'string' ? value.trim() || null : null
    }
  }

  let lines: InvoiceLineInput[] | undefined
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

  if ('recipients' in body) {
    const recipients = validateRecipientsField(body.recipients, fields)
    if (recipients !== undefined) output.recipients = recipients
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invoice validation failed', fields)
  }

  if (!partial) {
    return {
      client_id: output.client_id as string,
      currency: output.currency as string,
      lines: output.lines ?? [],
      ...(output.contact_id !== undefined ? { contact_id: output.contact_id } : {}),
      ...(output.owner_membership_id !== undefined
        ? { owner_membership_id: output.owner_membership_id }
        : {}),
      ...(output.issue_on !== undefined ? { issue_on: output.issue_on } : {}),
      ...(output.due_on !== undefined ? { due_on: output.due_on } : {}),
      ...(output.purchase_order_number !== undefined
        ? { purchase_order_number: output.purchase_order_number }
        : {}),
      ...(output.discount_cents !== undefined ? { discount_cents: output.discount_cents } : {}),
      ...(output.payment_terms !== undefined ? { payment_terms: output.payment_terms } : {}),
      ...(output.notes !== undefined ? { notes: output.notes } : {}),
      ...(output.internal_notes !== undefined ? { internal_notes: output.internal_notes } : {}),
      ...(output.recipients !== undefined ? { recipients: output.recipients } : {}),
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
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invoice void validation failed', {
      void_reason: 'Must be a string between 1 and 2000 characters',
    })
  }
  return value.trim()
}

function encodeCursor(row: InvoiceCursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeInvoiceCursor(value: string): InvoiceCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<InvoiceCursor>
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
    return new ApiError(412, 'PRECONDITION_FAILED', 'Invoice version does not match If-Match')
  }
  const idempotencyError = idempotencyConflictError(error)
  if (idempotencyError) return idempotencyError
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The invoice conflicts with an existing record')
  }
  if (error.code === '22023') {
    // Deliberate RAISE from our own RPCs; the message is user-facing.
    return new ApiError(422, 'VALIDATION_ERROR', error.message || 'Invoice validation failed')
  }
  if (error.code === '23503' || error.code === '23514' || error.code === '22003') {
    // Postgres-generated constraint messages leak schema details; keep generic.
    return new ApiError(422, 'VALIDATION_ERROR', 'The invoice failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', error.message || 'Invoice not found')
  }
  console.error('Invoice database operation failed', {
    request_id: requestId,
    code: error.code,
    message: error.message,
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Invoice operation failed')
}

function asInvoiceDocument(data: Json): InvoiceDocument {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Invoice RPC returned an unexpected payload')
  }
  const payload = data as {
    invoice?: InvoiceRow
    lines?: InvoiceLineRow[]
    recipients?: RecipientRow[]
  }
  if (!payload.invoice) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Invoice RPC returned an incomplete payload')
  }
  return {
    ...payload.invoice,
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    recipients: Array.isArray(payload.recipients) ? payload.recipients : [],
  }
}

function toRpcPayload(input: InvoiceHeaderInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'lines') continue
    if (value !== undefined) payload[key] = value
  }
  return payload
}

async function listInvoices(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const status = url.searchParams.get('status')
  if (status !== null && !INVOICE_STATUSES.includes(status as InvoiceStatus)) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is not supported', {
      status: 'Must be one of draft, sent, partial, paid, void',
    })
  }
  const clientId = url.searchParams.get('client_id')
  const cursorValue = url.searchParams.get('cursor')
  const cursor = cursorValue ? decodeInvoiceCursor(cursorValue) : null

  let query = db
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (status) query = query.eq('status', status as InvoiceStatus)
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

async function createInvoice(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
  actorUserId?: string | null,
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
  const validated = validateInvoiceBody(body, false, {
    defaultCurrency: organisation.default_currency,
  })
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('create_invoice_draft', {
    p_org_id: orgId,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines as unknown as Json,
    ...(actorUserId ? { p_actor_id: actorUserId } : {}),
  })

  if (error) throw databaseError(error, requestId)
  const document = asInvoiceDocument(data)

  return jsonResponse({ data: document }, 201, requestId, {
    etag: etag(document.version),
    location: `/api/v1/invoices/${document.id}`,
  })
}

async function findInvoiceDocument(
  db: DatabaseClient,
  orgId: string,
  invoiceId: string,
  requestId: string,
  actorUserId?: string | null,
): Promise<InvoiceDocument> {
  // Single transactional RPC: FOR SHARE on the header, then lines, so a concurrent
  // save cannot return a stale ETag with replaced lines.
  const { data, error } = await db.rpc('get_invoice_document', {
    p_invoice_id: invoiceId,
    p_org_id: orgId,
    ...(actorUserId ? { p_actor_id: actorUserId } : {}),
  })

  if (error) throw databaseError(error, requestId)
  return asInvoiceDocument(data)
}

async function getInvoice(
  db: DatabaseClient,
  orgId: string,
  invoiceId: string,
  requestId: string,
  actorUserId?: string | null,
): Promise<Response> {
  const data = await findInvoiceDocument(db, orgId, invoiceId, requestId, actorUserId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateInvoice(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  invoiceId: string,
  requestId: string,
  actorUserId?: string | null,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findInvoiceDocument(db, orgId, invoiceId, requestId, actorUserId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Invoice version does not match If-Match')
  }
  if (current.status !== 'draft') {
    throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be edited in this release')
  }

  const validated = validateInvoiceBody(await jsonBody(req), true)
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('save_invoice_draft', {
    p_invoice_id: invoiceId,
    p_org_id: orgId,
    p_expected_version: version,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines === undefined ? null : lines as unknown as Json,
    ...(actorUserId ? { p_actor_id: actorUserId } : {}),
  })

  if (error) throw databaseError(error, requestId)
  const document = asInvoiceDocument(data)

  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

async function deleteInvoice(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  invoiceId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findInvoiceDocument(db, orgId, invoiceId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Invoice version does not match If-Match')
  }

  const { error } = await db.rpc('soft_delete_invoice_draft', {
    p_invoice_id: invoiceId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

/** Idempotency request payload — omits expected_version (If-Match is first-exec only). */
export function invoiceLifecycleIdempotencyPayload(
  invoiceId: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return { invoice_id: invoiceId, ...extras }
}

function invoiceEnvelopeResponse(
  envelope: IdempotencyEnvelope,
  requestId: string,
  rawKey: string,
): Response {
  return jsonResponse(
    envelope.response_body ?? { data: null },
    envelope.response_status ?? 200,
    requestId,
    {
      ...(envelope.response_headers ?? {}),
      [IDEMPOTENCY_KEY_HEADER]: rawKey,
    },
  )
}

async function sendInvoiceRoute(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  invoiceId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const rawKey = parseIdempotencyKey(req)
  const route = `/api/v1/invoices/${invoiceId}/send`
  const requestHash = await hashIdempotencyRequest(
    route,
    invoiceLifecycleIdempotencyPayload(invoiceId),
  )
  const keyHash = await sha256Hex(rawKey)

  const { data, error } = await db.rpc('send_invoice_idempotent', {
    p_invoice_id: invoiceId,
    p_org_id: orgId,
    p_expected_version: version,
    p_idempotency_key_hash: keyHash,
    p_request_hash: requestHash,
    p_route: route,
  })

  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Invoice send returned an unexpected payload')
  }
  const envelope = data as IdempotencyEnvelope
  if (envelope.replay !== true) {
    await dispatchPlaybookTriggersSafe({
      orgId,
      triggerKind: 'invoice.sent',
      rootEntityType: 'invoice',
      rootEntityId: invoiceId,
      payload: { invoice_id: invoiceId },
    })
  }
  return invoiceEnvelopeResponse(envelope, requestId, rawKey)
}

async function voidInvoiceRoute(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  invoiceId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const voidReason = validateVoidBody(await jsonBody(req))
  const rawKey = parseIdempotencyKey(req)
  const route = `/api/v1/invoices/${invoiceId}/void`
  const requestHash = await hashIdempotencyRequest(
    route,
    invoiceLifecycleIdempotencyPayload(invoiceId, { void_reason: voidReason }),
  )
  const keyHash = await sha256Hex(rawKey)

  const { data, error } = await db.rpc('void_invoice_idempotent', {
    p_invoice_id: invoiceId,
    p_org_id: orgId,
    p_expected_version: version,
    p_void_reason: voidReason,
    p_idempotency_key_hash: keyHash,
    p_request_hash: requestHash,
    p_route: route,
  })

  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Invoice void returned an unexpected payload')
  }
  return invoiceEnvelopeResponse(data as IdempotencyEnvelope, requestId, rawKey)
}

/** Primary contract: POST /api/v1/invoices/from-quote with `{ quote_id }`. */
export async function createInvoiceFromQuoteRoute(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
  quoteIdFromPath?: string,
): Promise<Response> {
  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for quote conversion')
  }

  let quoteId = quoteIdFromPath
  if (!quoteId) {
    const body = await jsonBody(req)
    if (!('quote_id' in body) || typeof body.quote_id !== 'string') {
      throw new ApiError(400, 'BAD_REQUEST', 'quote_id is required', {
        quote_id: 'Must be a UUID',
      })
    }
    quoteId = parseUuid(body.quote_id, 'quote_id')
  }

  const { data, error } = await db.rpc('create_invoice_from_quote', {
    p_quote_id: quoteId,
    p_org_id: orgId,
  })

  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Invoice RPC returned an unexpected payload')
  }
  const created = (data as { created?: boolean }).created !== false
  const document = asInvoiceDocument(data as Json)

  return jsonResponse({ data: document }, created ? 201 : 200, requestId, {
    etag: etag(document.version),
    location: `/api/v1/invoices/${document.id}`,
  })
}

export function handleInvoices(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
  actorUserId?: string | null,
): Promise<Response> {
  if (path === '/api/v1/invoices') {
    if (req.method === 'GET') return listInvoices(req, db, orgId, requestId)
    if (req.method === 'POST') {
      return createInvoice(req, db, orgId, requestId, actorUserId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for invoices')
  }

  if (path === '/api/v1/invoices/from-quote') {
    if (req.method === 'POST') {
      return createInvoiceFromQuoteRoute(req, db, orgId, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for invoice from-quote')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/invoices\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(send|void))?$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const invoiceId = itemMatch[1]
  const action = itemMatch[2]

  if (action === 'send') {
    if (req.method === 'POST') return sendInvoiceRoute(req, db, orgId, invoiceId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for invoice send')
  }

  if (action === 'void') {
    if (req.method === 'POST') return voidInvoiceRoute(req, db, orgId, invoiceId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for invoice void')
  }

  if (req.method === 'GET') return getInvoice(db, orgId, invoiceId, requestId, actorUserId)
  if (req.method === 'PATCH') {
    return updateInvoice(req, db, orgId, invoiceId, requestId, actorUserId)
  }
  if (req.method === 'DELETE') return deleteInvoice(req, db, orgId, invoiceId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for invoice')
}
