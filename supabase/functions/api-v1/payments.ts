import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, PaymentAllocationRow, PaymentRow } from '../_shared/database.ts'
import { dispatchPlaybookTriggersSafe, extractEnvelopeData } from '../_shared/playbook-dispatch.ts'
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

const PAYMENT_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,version,direction,client_id,vendor_id,amount_cents,currency,method,status,occurred_on,reference,provider,provider_payment_id,notes,reverses_payment_id,completed_at,metadata'

const DIRECTIONS = new Set(['inbound', 'outbound'])
const METHODS = new Set(['bank', 'card', 'cash', 'stripe', 'other'])
const STATUSES = new Set([
  'pending',
  'completed',
  'unallocated',
  'part_allocated',
  'allocated',
  'refunded',
  'reversed',
  'failed',
])

type DatabaseClient = SupabaseClient<Database>

type AllocationInput = {
  invoice_id?: string
  bill_id?: string
  amount_cents: number
}

type PaymentCreate = {
  direction: 'inbound' | 'outbound'
  client_id?: string
  vendor_id?: string
  amount_cents: number
  currency: string
  method: string
  occurred_on?: string
  reference?: string | null
  provider?: string
  provider_payment_id?: string | null
  notes?: string | null
  metadata?: Record<string, unknown>
  allocations?: AllocationInput[]
}

type PaymentDocument = PaymentRow & {
  allocations: PaymentAllocationRow[]
  reversing_payment?: PaymentRow
}

interface PaymentCursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

interface IdempotencyEnvelope {
  replay?: boolean
  response_status?: number
  response_body?: unknown
  response_headers?: Record<string, string>
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

function isSafePositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
}

function validateAllocations(value: unknown): AllocationInput[] {
  if (!Array.isArray(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Payment validation failed', {
      allocations: 'Must be an array',
    })
  }
  if (value.length > 200) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Payment validation failed', {
      allocations: 'Must not exceed 200 items',
    })
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Payment validation failed', {
        [`allocations.${index}`]: 'Must be an object',
      })
    }
    const body = raw as Record<string, unknown>
    const fields: Record<string, string> = {}
    const prefix = `allocations.${index}`

    let invoiceId: string | undefined
    let billId: string | undefined
    if ('invoice_id' in body && body.invoice_id != null) {
      if (typeof body.invoice_id !== 'string') {
        fields[`${prefix}.invoice_id`] = 'Must be a UUID'
      } else {
        try {
          invoiceId = parseUuid(body.invoice_id, `${prefix}.invoice_id`)
        } catch {
          fields[`${prefix}.invoice_id`] = 'Must be a UUID'
        }
      }
    }
    if ('bill_id' in body && body.bill_id != null) {
      if (typeof body.bill_id !== 'string') {
        fields[`${prefix}.bill_id`] = 'Must be a UUID'
      } else {
        try {
          billId = parseUuid(body.bill_id, `${prefix}.bill_id`)
        } catch {
          fields[`${prefix}.bill_id`] = 'Must be a UUID'
        }
      }
    }

    if ((invoiceId && billId) || (!invoiceId && !billId)) {
      fields[prefix] = 'Provide exactly one of invoice_id or bill_id'
    }

    const amount = body.amount_cents
    if (typeof amount !== 'number' || !isSafePositiveInt(amount)) {
      fields[`${prefix}.amount_cents`] = 'Must be a positive integer'
    }

    if (Object.keys(fields).length > 0) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Payment validation failed', fields)
    }

    return {
      ...(invoiceId ? { invoice_id: invoiceId } : {}),
      ...(billId ? { bill_id: billId } : {}),
      amount_cents: amount as number,
    }
  })
}

export function validateCreateBody(body: Record<string, unknown>): PaymentCreate {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'direction',
    'client_id',
    'vendor_id',
    'amount_cents',
    'currency',
    'method',
    'occurred_on',
    'reference',
    'provider',
    'provider_payment_id',
    'notes',
    'metadata',
    'allocations',
  ])

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  const direction = body.direction
  if (typeof direction !== 'string' || !DIRECTIONS.has(direction)) {
    fields.direction = 'Must be inbound or outbound'
  }

  let clientId: string | undefined
  if ('client_id' in body && body.client_id != null) {
    if (typeof body.client_id !== 'string') {
      fields.client_id = 'Must be a UUID'
    } else {
      try {
        clientId = parseUuid(body.client_id, 'client_id')
      } catch {
        fields.client_id = 'Must be a UUID'
      }
    }
  }

  let vendorId: string | undefined
  if ('vendor_id' in body && body.vendor_id != null) {
    if (typeof body.vendor_id !== 'string') {
      fields.vendor_id = 'Must be a UUID'
    } else {
      try {
        vendorId = parseUuid(body.vendor_id, 'vendor_id')
      } catch {
        fields.vendor_id = 'Must be a UUID'
      }
    }
  }

  if (direction === 'inbound' && !clientId) {
    fields.client_id = 'Required for inbound payments'
  }
  if (direction === 'outbound' && !vendorId) {
    fields.vendor_id = 'Required for outbound payments'
  }

  const amount = body.amount_cents
  if (typeof amount !== 'number' || !isSafePositiveInt(amount)) {
    fields.amount_cents = 'Must be a positive integer'
  }

  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(currency)) {
    fields.currency = 'Must be a 3-letter ISO currency code'
  }

  const method = typeof body.method === 'string' ? body.method.trim() : ''
  if (!METHODS.has(method)) {
    fields.method = 'Must be one of bank, card, cash, stripe, other'
  }

  let occurredOn: string | undefined
  if ('occurred_on' in body && body.occurred_on != null) {
    if (typeof body.occurred_on !== 'string' || !isValidDateOnly(body.occurred_on)) {
      fields.occurred_on = 'Must be a YYYY-MM-DD date'
    } else {
      occurredOn = body.occurred_on
    }
  }

  let reference: string | null | undefined
  if ('reference' in body) {
    if (body.reference === null) reference = null
    else if (typeof body.reference !== 'string' || body.reference.trim().length > 200) {
      fields.reference = 'Must be a string up to 200 characters or null'
    } else {
      reference = body.reference.trim() || null
    }
  }

  let provider = 'manual'
  if ('provider' in body && body.provider != null) {
    if (
      typeof body.provider !== 'string' || body.provider.trim().length < 1 ||
      body.provider.trim().length > 64
    ) {
      fields.provider = 'Must be a string between 1 and 64 characters'
    } else {
      provider = body.provider.trim()
    }
  }

  let providerPaymentId: string | null | undefined
  if ('provider_payment_id' in body) {
    if (body.provider_payment_id === null) providerPaymentId = null
    else if (
      typeof body.provider_payment_id !== 'string' ||
      body.provider_payment_id.trim().length > 200
    ) {
      fields.provider_payment_id = 'Must be a string up to 200 characters or null'
    } else {
      providerPaymentId = body.provider_payment_id.trim() || null
    }
  }

  let notes: string | null | undefined
  if ('notes' in body) {
    if (body.notes === null) notes = null
    else if (typeof body.notes !== 'string' || body.notes.trim().length > 4000) {
      fields.notes = 'Must be a string up to 4000 characters or null'
    } else {
      notes = body.notes.trim() || null
    }
  }

  let metadata: Record<string, unknown> | undefined
  if ('metadata' in body) {
    if (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      fields.metadata = 'Must be an object'
    } else if (
      new TextEncoder().encode(JSON.stringify(body.metadata)).byteLength > 16_384
    ) {
      fields.metadata = 'Must not exceed 16 KiB'
    } else {
      metadata = body.metadata as Record<string, unknown>
    }
  }

  let allocations: AllocationInput[] | undefined
  if ('allocations' in body) {
    try {
      allocations = validateAllocations(body.allocations)
    } catch (error) {
      if (error instanceof ApiError) throw error
      fields.allocations = 'Invalid allocations payload'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Payment validation failed', fields)
  }

  return {
    direction: direction as 'inbound' | 'outbound',
    ...(clientId ? { client_id: clientId } : {}),
    ...(vendorId ? { vendor_id: vendorId } : {}),
    amount_cents: amount as number,
    currency,
    method,
    ...(occurredOn ? { occurred_on: occurredOn } : {}),
    ...(reference !== undefined ? { reference } : {}),
    provider,
    ...(providerPaymentId !== undefined ? { provider_payment_id: providerPaymentId } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(metadata ? { metadata } : {}),
    ...(allocations ? { allocations } : {}),
  }
}

export function validateAllocateBody(body: Record<string, unknown>): AllocationInput[] {
  if (!('allocations' in body)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Payment allocate validation failed', {
      allocations: 'Required',
    })
  }
  const allocations = validateAllocations(body.allocations)
  if (allocations.length < 1) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Payment allocate validation failed', {
      allocations: 'Must contain at least one allocation',
    })
  }
  return allocations
}

export function validateReverseBody(body: Record<string, unknown>): string {
  const value = body.reason ?? body.reversal_reason
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 2000) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Payment reverse validation failed', {
      reason: 'Must be a string between 1 and 2000 characters',
    })
  }
  return value.trim()
}

function encodeCursor(row: PaymentCursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodePaymentCursor(value: string): PaymentCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<PaymentCursor>
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
    return new ApiError(412, 'PRECONDITION_FAILED', 'Payment version does not match If-Match')
  }
  if (
    error.message?.toLowerCase().includes('idempotency-key was reused') ||
    (error.code === '23505' && error.message?.toLowerCase().includes('idempotency'))
  ) {
    return new ApiError(
      409,
      'CONFLICT',
      'Idempotency-Key was reused with a different request payload',
    )
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The payment conflicts with an existing record')
  }
  if (error.code === '55000') {
    return new ApiError(409, 'CONFLICT', 'An identical request is already in progress')
  }
  if (error.code === '22023') {
    // Deliberate RAISE from our own RPCs; the message is user-facing.
    return new ApiError(422, 'VALIDATION_ERROR', error.message || 'Payment validation failed')
  }
  if (error.code === '23503' || error.code === '23514' || error.code === '22003') {
    // Postgres-generated constraint messages leak schema details; keep generic.
    return new ApiError(422, 'VALIDATION_ERROR', 'The payment failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', error.message || 'Payment not found')
  }
  console.error('Payment database operation failed', {
    request_id: requestId,
    code: error.code,
    message: error.message,
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Payment operation failed')
}

function asPaymentDocument(data: Json): PaymentDocument {
  const payload = data as {
    payment?: PaymentRow
    allocations?: PaymentAllocationRow[]
    reversing_payment?: PaymentRow
  }
  if (!payload.payment) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Payment RPC returned an incomplete payload')
  }
  return {
    ...payload.payment,
    allocations: Array.isArray(payload.allocations) ? payload.allocations : [],
    ...(payload.reversing_payment ? { reversing_payment: payload.reversing_payment } : {}),
  }
}

function envelopeResponse(
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

async function listPayments(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const direction = url.searchParams.get('direction')
  const status = url.searchParams.get('status')
  const clientId = url.searchParams.get('client_id')
  const vendorId = url.searchParams.get('vendor_id')
  const invoiceIdParam = url.searchParams.get('invoice_id')
  const billIdParam = url.searchParams.get('bill_id')
  const cursorParam = url.searchParams.get('cursor')

  if (direction && !DIRECTIONS.has(direction)) {
    throw new ApiError(400, 'BAD_REQUEST', 'direction is invalid', {
      direction: 'Must be inbound or outbound',
    })
  }
  if (status && !STATUSES.has(status)) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is invalid', {
      status: 'Must be a known payment status',
    })
  }
  if (invoiceIdParam && billIdParam) {
    throw new ApiError(400, 'BAD_REQUEST', 'invoice_id and bill_id are mutually exclusive', {
      invoice_id: 'Provide at most one of invoice_id or bill_id',
      bill_id: 'Provide at most one of invoice_id or bill_id',
    })
  }

  // Doc filters resolve payment ids via payment_allocations (includes reversed history).
  let paymentIdsFilter: string[] | null = null
  if (invoiceIdParam) {
    const invoiceId = parseUuid(invoiceIdParam, 'invoice_id')
    const { data: allocRows, error: allocError } = await db
      .from('payment_allocations')
      .select('payment_id')
      .eq('org_id', orgId)
      .eq('invoice_id', invoiceId)
    if (allocError) throw databaseError(allocError, requestId)
    paymentIdsFilter = [
      ...new Set((allocRows ?? []).map((row) => (row as { payment_id: string }).payment_id)),
    ]
    if (paymentIdsFilter.length === 0) {
      return jsonResponse({ data: [], meta: { next_cursor: null } }, 200, requestId)
    }
  } else if (billIdParam) {
    const billId = parseUuid(billIdParam, 'bill_id')
    const { data: allocRows, error: allocError } = await db
      .from('payment_allocations')
      .select('payment_id')
      .eq('org_id', orgId)
      .eq('bill_id', billId)
    if (allocError) throw databaseError(allocError, requestId)
    paymentIdsFilter = [
      ...new Set((allocRows ?? []).map((row) => (row as { payment_id: string }).payment_id)),
    ]
    if (paymentIdsFilter.length === 0) {
      return jsonResponse({ data: [], meta: { next_cursor: null } }, 200, requestId)
    }
  }

  let query = db
    .from('payments')
    .select(PAYMENT_SELECT)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (direction) query = query.eq('direction', direction as PaymentRow['direction'])
  if (status) query = query.eq('status', status as PaymentRow['status'])
  if (clientId) query = query.eq('client_id', parseUuid(clientId, 'client_id'))
  if (vendorId) query = query.eq('vendor_id', parseUuid(vendorId, 'vendor_id'))
  if (paymentIdsFilter) query = query.in('id', paymentIdsFilter)

  if (cursorParam) {
    const cursor = decodePaymentCursor(cursorParam)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)
  const rows = (data ?? []) as PaymentRow[]
  const page = rows.slice(0, limit)
  const next = rows.length > limit
    ? encodeCursor({ created_at: page[page.length - 1].created_at, id: page[page.length - 1].id })
    : null

  return jsonResponse({ data: page, meta: { next_cursor: next } }, 200, requestId)
}

async function getPayment(
  db: DatabaseClient,
  orgId: string,
  paymentId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('get_payment', {
    p_payment_id: paymentId,
    p_org_id: orgId,
  })
  if (error) throw databaseError(error, requestId)
  const document = asPaymentDocument(data as Json)
  return jsonResponse({ data: document }, 200, requestId, { etag: etag(document.version) })
}

async function createPayment(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const rawKey = parseIdempotencyKey(req)
  const route = '/api/v1/payments'
  const validated = validateCreateBody(await jsonBody(req))
  const { allocations, ...header } = validated
  const requestHash = await hashIdempotencyRequest(route, {
    ...header,
    ...(allocations ? { allocations } : {}),
  })
  const keyHash = await sha256Hex(rawKey)

  const { data, error } = await db.rpc('create_payment_idempotent', {
    p_org_id: orgId,
    p_payload: header as unknown as Json,
    p_allocations: (allocations ?? []) as unknown as Json,
    p_idempotency_key_hash: keyHash,
    p_request_hash: requestHash,
    p_route: route,
  })
  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'create payment returned an unexpected payload')
  }
  const envelope = data as IdempotencyEnvelope
  if (envelope.replay !== true) {
    const payment = extractEnvelopeData(envelope)
    if (
      payment &&
      payment.direction === 'inbound' &&
      typeof payment.id === 'string'
    ) {
      await dispatchPlaybookTriggersSafe({
        orgId,
        triggerKind: 'payment.received',
        rootEntityType: 'payment',
        rootEntityId: payment.id,
        payload: {
          payment_id: payment.id,
          client_id: payment.client_id ?? null,
          amount_cents: payment.amount_cents ?? null,
          currency: payment.currency ?? null,
        },
      })
    }
  }
  return envelopeResponse(envelope, requestId, rawKey)
}

/** Allocate/reverse omit expected_version from the hash: If-Match is first-exec only. */
export function paymentMutationIdempotencyPayload(
  paymentId: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return { payment_id: paymentId, ...body }
}

async function allocatePayment(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  paymentId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const rawKey = parseIdempotencyKey(req)
  const route = `/api/v1/payments/${paymentId}/allocate`
  const allocations = validateAllocateBody(await jsonBody(req))
  const requestHash = await hashIdempotencyRequest(
    route,
    paymentMutationIdempotencyPayload(paymentId, { allocations }),
  )
  const keyHash = await sha256Hex(rawKey)

  const { data, error } = await db.rpc('allocate_payment_idempotent', {
    p_payment_id: paymentId,
    p_org_id: orgId,
    p_expected_version: version,
    p_allocations: allocations as unknown as Json,
    p_idempotency_key_hash: keyHash,
    p_request_hash: requestHash,
    p_route: route,
  })
  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'allocate payment returned an unexpected payload')
  }
  return envelopeResponse(data as IdempotencyEnvelope, requestId, rawKey)
}

async function reversePayment(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  paymentId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const rawKey = parseIdempotencyKey(req)
  const route = `/api/v1/payments/${paymentId}/reverse`
  const reason = validateReverseBody(await jsonBody(req))
  const requestHash = await hashIdempotencyRequest(
    route,
    paymentMutationIdempotencyPayload(paymentId, { reason }),
  )
  const keyHash = await sha256Hex(rawKey)

  const { data, error } = await db.rpc('reverse_payment_idempotent', {
    p_payment_id: paymentId,
    p_org_id: orgId,
    p_expected_version: version,
    p_reason: reason,
    p_idempotency_key_hash: keyHash,
    p_request_hash: requestHash,
    p_route: route,
  })
  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'reverse payment returned an unexpected payload')
  }
  return envelopeResponse(data as IdempotencyEnvelope, requestId, rawKey)
}

export function handlePayments(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/payments') {
    if (req.method === 'GET') return listPayments(req, db, orgId, requestId)
    if (req.method === 'POST') return createPayment(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for payments')
  }

  const allocateMatch = path.match(
    /^\/api\/v1\/payments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/allocate$/i,
  )
  if (allocateMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for payment allocate')
    }
    return allocatePayment(req, db, orgId, allocateMatch[1], requestId)
  }

  const reverseMatch = path.match(
    /^\/api\/v1\/payments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/reverse$/i,
  )
  if (reverseMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for payment reverse')
    }
    return reversePayment(req, db, orgId, reverseMatch[1], requestId)
  }

  const itemMatch = path.match(
    /^\/api\/v1\/payments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  if (req.method === 'GET') return getPayment(db, orgId, itemMatch[1], requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for payment')
}
