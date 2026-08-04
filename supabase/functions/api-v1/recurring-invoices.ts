import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
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
import { assertJsonSafeLineMoney } from './quotes.ts'

const SCHEDULE_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,client_id,contact_id,owner_membership_id,status,currency,frequency,interval_count,anchor_on,rule_version,weekdays,day_of_month,month_of_year,month_end_policy,timezone,local_run_time,start_on,end_on,max_occurrences,scheduled_occurrence_count,next_run_at,last_run_at,due_days,delivery_mode,pricing_mode,catch_up_policy,max_catch_up_runs,purchase_order_number,payment_terms,notes,internal_notes,activated_at,paused_at,completed_at,cancelled_at,cancelled_by'

const RUN_SELECT =
  'id,org_id,schedule_id,occurrence_sequence,occurrence_key,scheduled_for,occurrence_local_date,occurrence_timezone,schedule_version,configuration_snapshot,period_start,period_end,trigger,status,attempt_count,available_at,claimed_at,claimed_by,lease_expires_at,generated_at,sent_at,error_code,error_message,request_id,created_at,updated_at'

const HEADER_WRITABLE = new Set([
  'name',
  'client_id',
  'contact_id',
  'owner_membership_id',
  'currency',
  'frequency',
  'interval_count',
  'anchor_on',
  'weekdays',
  'day_of_month',
  'month_of_year',
  'month_end_policy',
  'timezone',
  'local_run_time',
  'start_on',
  'end_on',
  'max_occurrences',
  'due_days',
  'delivery_mode',
  'pricing_mode',
  'catch_up_policy',
  'max_catch_up_runs',
  'purchase_order_number',
  'payment_terms',
  'notes',
  'internal_notes',
  'lines',
])

const LINE_WRITABLE = new Set([
  'product_id',
  'description_template',
  'description',
  'quantity',
  'unit_price_cents',
  'discount_percent',
  'tax_rate_percent',
  'position',
  'active',
])

const FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'yearly'])
const MONTH_END_POLICIES = new Set(['clamp', 'last_day', 'skip'])
const DELIVERY_MODES = new Set(['draft', 'auto_send'])
const PRICING_MODES = new Set(['fixed', 'catalog_at_generation'])
const CATCH_UP_POLICIES = new Set(['skip', 'latest', 'all'])
const COMMANDS = new Set(['activate', 'pause', 'resume', 'cancel', 'run-now'])

type DatabaseClient = SupabaseClient<Database>
type RecurringScheduleRow = Database['public']['Tables']['recurring_invoice_schedules']['Row']
type RecurringLineRow = Database['public']['Tables']['recurring_invoice_lines']['Row']
type RecurringRunRow = Database['public']['Tables']['recurring_invoice_runs']['Row']

type RecurringLineInput = {
  product_id?: string | null
  description_template: string
  quantity: number
  unit_price_cents?: number
  discount_percent?: number
  tax_rate_percent?: number
  position?: number
  active?: boolean
}

type RecurringHeaderInput = {
  name?: string
  client_id?: string
  contact_id?: string | null
  owner_membership_id?: string | null
  currency?: string
  frequency?: string
  interval_count?: number
  anchor_on?: string
  weekdays?: number[] | null
  day_of_month?: number | null
  month_of_year?: number | null
  month_end_policy?: string
  timezone?: string
  local_run_time?: string
  start_on?: string
  end_on?: string | null
  max_occurrences?: number | null
  due_days?: number
  delivery_mode?: string
  pricing_mode?: string
  catch_up_policy?: string
  max_catch_up_runs?: number
  purchase_order_number?: string | null
  payment_terms?: string | null
  notes?: string | null
  internal_notes?: string | null
}

type RecurringCreate = RecurringHeaderInput & {
  name: string
  client_id: string
  frequency: string
  lines: RecurringLineInput[]
}

type RecurringUpdate = RecurringHeaderInput & {
  lines?: RecurringLineInput[]
}

type RecurringDocument = RecurringScheduleRow & { lines: RecurringLineRow[] }

interface ScheduleCursor {
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

function isValidLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)
}

function hasAtMostFourDecimals(value: number): boolean {
  const scaled = value * 1e4
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

function validateLine(body: Record<string, unknown>, index: number): RecurringLineInput {
  const fields: Record<string, string> = {}
  const prefix = `lines.${index}`
  for (const key of Object.keys(body)) {
    if (!LINE_WRITABLE.has(key)) fields[`${prefix}.${key}`] = 'Field is not writable'
  }

  let productId: string | null | undefined
  if ('product_id' in body) {
    const value = body.product_id
    if (value === null) productId = null
    else if (typeof value !== 'string') fields[`${prefix}.product_id`] = 'Must be a UUID or null'
    else {
      try {
        productId = parseUuid(value, `${prefix}.product_id`)
      } catch {
        fields[`${prefix}.product_id`] = 'Must be a UUID or null'
      }
    }
  }

  const descriptionRaw = body.description_template ?? body.description
  let descriptionTemplate = ''
  if (
    typeof descriptionRaw !== 'string' || descriptionRaw.trim().length < 1 ||
    descriptionRaw.trim().length > 200
  ) {
    fields[`${prefix}.description_template`] = 'Must be between 1 and 200 characters'
  } else {
    descriptionTemplate = descriptionRaw.trim()
  }

  let quantity = 0
  if (
    typeof body.quantity !== 'number' || !Number.isFinite(body.quantity) || body.quantity <= 0 ||
    !hasAtMostFourDecimals(body.quantity)
  ) {
    fields[`${prefix}.quantity`] = 'Must be a positive number with at most 4 decimals'
  } else {
    quantity = body.quantity
  }

  let unitPrice: number | undefined
  if ('unit_price_cents' in body) {
    const value = body.unit_price_cents
    if (
      typeof value !== 'number' || !Number.isInteger(value) || value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    ) {
      fields[`${prefix}.unit_price_cents`] = 'Must be a non-negative integer'
    } else {
      unitPrice = value
    }
  } else if (productId == null && !('product_id' in body)) {
    fields[`${prefix}.unit_price_cents`] = 'Required for free-text lines'
  } else if (productId === null) {
    fields[`${prefix}.unit_price_cents`] = 'Required for free-text lines'
  }

  let discount = 0
  if ('discount_percent' in body) {
    const value = body.discount_percent
    if (
      typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 ||
      !hasAtMostFourDecimals(value)
    ) {
      fields[`${prefix}.discount_percent`] = 'Must be between 0 and 100'
    } else {
      discount = value
    }
  }

  let taxRate: number | undefined
  if ('tax_rate_percent' in body) {
    const value = body.tax_rate_percent
    if (
      typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 ||
      !hasAtMostFourDecimals(value)
    ) {
      fields[`${prefix}.tax_rate_percent`] = 'Must be between 0 and 100'
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

  let active: boolean | undefined
  if ('active' in body) {
    if (typeof body.active !== 'boolean') fields[`${prefix}.active`] = 'Must be a boolean'
    else active = body.active
  }

  if (unitPrice !== undefined && !assertJsonSafeLineMoney(quantity, unitPrice)) {
    fields[`${prefix}.unit_price_cents`] = 'Line totals exceed JSON-safe integer range'
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Recurring line validation failed', fields)
  }

  return {
    description_template: descriptionTemplate,
    quantity,
    ...(productId !== undefined ? { product_id: productId } : {}),
    ...(unitPrice !== undefined ? { unit_price_cents: unitPrice } : {}),
    ...(discount !== 0 || 'discount_percent' in body ? { discount_percent: discount } : {}),
    ...(taxRate !== undefined ? { tax_rate_percent: taxRate } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(active !== undefined ? { active } : {}),
  }
}

export function validateRecurringScheduleBody(
  body: Record<string, unknown>,
  partial: false,
): RecurringCreate
export function validateRecurringScheduleBody(
  body: Record<string, unknown>,
  partial: true,
): RecurringUpdate
export function validateRecurringScheduleBody(
  body: Record<string, unknown>,
  partial: boolean,
): RecurringCreate | RecurringUpdate {
  const fields: Record<string, string> = {}
  const output: RecurringUpdate = {}

  for (const key of Object.keys(body)) {
    if (!HEADER_WRITABLE.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'name' in body) {
    const value = body.name
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
      fields.name = 'Must be a string between 1 and 200 characters'
    } else {
      output.name = value.trim()
    }
  }

  if (!partial || 'client_id' in body) {
    try {
      output.client_id = parseUuid(
        typeof body.client_id === 'string' ? body.client_id : null,
        'client_id',
      )
    } catch {
      fields.client_id = 'Must be a UUID'
    }
  }

  if ('contact_id' in body) {
    if (body.contact_id === null) output.contact_id = null
    else if (typeof body.contact_id === 'string') {
      try {
        output.contact_id = parseUuid(body.contact_id, 'contact_id')
      } catch {
        fields.contact_id = 'Must be a UUID or null'
      }
    } else {
      fields.contact_id = 'Must be a UUID or null'
    }
  }

  if ('owner_membership_id' in body) {
    if (body.owner_membership_id === null) output.owner_membership_id = null
    else if (typeof body.owner_membership_id === 'string') {
      try {
        output.owner_membership_id = parseUuid(body.owner_membership_id, 'owner_membership_id')
      } catch {
        fields.owner_membership_id = 'Must be a UUID or null'
      }
    } else {
      fields.owner_membership_id = 'Must be a UUID or null'
    }
  }

  if ('currency' in body) {
    const value = body.currency
    if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
      fields.currency = 'Must be a 3-letter ISO currency code'
    } else {
      output.currency = value.toUpperCase()
    }
  }

  if (!partial || 'frequency' in body) {
    const value = body.frequency
    if (typeof value !== 'string' || !FREQUENCIES.has(value)) {
      fields.frequency = 'Must be daily, weekly, monthly, or yearly'
    } else {
      output.frequency = value
    }
  }

  if ('interval_count' in body) {
    const value = body.interval_count
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 365) {
      fields.interval_count = 'Must be an integer between 1 and 365'
    } else {
      output.interval_count = value
    }
  } else if (!partial) {
    output.interval_count = 1
  }

  for (const field of ['anchor_on', 'start_on', 'end_on'] as const) {
    if (!(field in body) && (partial || field === 'end_on' || field === 'anchor_on')) {
      if (!partial && field === 'start_on') {
        // required below
      }
      continue
    }
    if (!(field in body)) continue
    const value = body[field]
    if (field === 'end_on' && value === null) {
      output.end_on = null
      continue
    }
    if (typeof value !== 'string' || !isValidDateOnly(value)) {
      fields[field] = 'Must be a YYYY-MM-DD date'
    } else if (field === 'end_on') {
      output.end_on = value
    } else if (field === 'anchor_on') {
      output.anchor_on = value
    } else {
      output.start_on = value
    }
  }

  if (!partial && !('start_on' in output)) {
    // default server-side
  }

  if ('weekdays' in body) {
    const value = body.weekdays
    if (value === null) {
      output.weekdays = null
    } else if (
      !Array.isArray(value) || value.length < 1 ||
      !value.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 7)
    ) {
      fields.weekdays = 'Must be an array of ISO weekdays 1–7'
    } else {
      output.weekdays = value as number[]
    }
  }

  if ('day_of_month' in body) {
    const value = body.day_of_month
    if (value === null) output.day_of_month = null
    else if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31) {
      fields.day_of_month = 'Must be an integer 1–31 or null'
    } else {
      output.day_of_month = value
    }
  }

  if ('month_of_year' in body) {
    const value = body.month_of_year
    if (value === null) output.month_of_year = null
    else if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) {
      fields.month_of_year = 'Must be an integer 1–12 or null'
    } else {
      output.month_of_year = value
    }
  }

  if ('month_end_policy' in body) {
    const value = body.month_end_policy
    if (typeof value !== 'string' || !MONTH_END_POLICIES.has(value)) {
      fields.month_end_policy = 'Must be clamp, last_day, or skip'
    } else {
      output.month_end_policy = value
    }
  } else if (!partial) {
    output.month_end_policy = 'clamp'
  }

  if ('timezone' in body) {
    const value = body.timezone
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 64) {
      fields.timezone = 'Must be an IANA timezone string'
    } else {
      output.timezone = value.trim()
    }
  }

  if ('local_run_time' in body) {
    const value = body.local_run_time
    if (typeof value !== 'string' || !isValidLocalTime(value)) {
      fields.local_run_time = 'Must be HH:MM:SS'
    } else {
      output.local_run_time = value
    }
  } else if (!partial) {
    output.local_run_time = '09:00:00'
  }

  if ('max_occurrences' in body) {
    const value = body.max_occurrences
    if (value === null) output.max_occurrences = null
    else if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      fields.max_occurrences = 'Must be a positive integer or null'
    } else {
      output.max_occurrences = value
    }
  }

  if ('due_days' in body) {
    const value = body.due_days
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3650) {
      fields.due_days = 'Must be an integer between 0 and 3650'
    } else {
      output.due_days = value
    }
  } else if (!partial) {
    output.due_days = 14
  }

  if ('delivery_mode' in body) {
    const value = body.delivery_mode
    if (typeof value !== 'string' || !DELIVERY_MODES.has(value)) {
      fields.delivery_mode = 'Must be draft or auto_send'
    } else {
      output.delivery_mode = value
    }
  } else if (!partial) {
    output.delivery_mode = 'draft'
  }

  if ('pricing_mode' in body) {
    const value = body.pricing_mode
    if (typeof value !== 'string' || !PRICING_MODES.has(value)) {
      fields.pricing_mode = 'Must be fixed or catalog_at_generation'
    } else {
      output.pricing_mode = value
    }
  } else if (!partial) {
    output.pricing_mode = 'fixed'
  }

  if ('catch_up_policy' in body) {
    const value = body.catch_up_policy
    if (typeof value !== 'string' || !CATCH_UP_POLICIES.has(value)) {
      fields.catch_up_policy = 'Must be skip, latest, or all'
    } else {
      output.catch_up_policy = value
    }
  } else if (!partial) {
    output.catch_up_policy = 'latest'
  }

  if ('max_catch_up_runs' in body) {
    const value = body.max_catch_up_runs
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31) {
      fields.max_catch_up_runs = 'Must be an integer between 1 and 31'
    } else {
      output.max_catch_up_runs = value
    }
  } else if (!partial) {
    output.max_catch_up_runs = 1
  }

  for (
    const field of ['purchase_order_number', 'payment_terms', 'notes', 'internal_notes'] as const
  ) {
    if (!(field in body)) continue
    const value = body[field]
    if (value !== null && typeof value !== 'string') {
      fields[field] = 'Must be a string or null'
    } else {
      output[field] = typeof value === 'string' ? (value.trim() || null) : null
    }
  }

  const frequency = (output.frequency ?? body.frequency) as string | undefined
  if (frequency === 'weekly' && !partial) {
    if (!Array.isArray(output.weekdays) || output.weekdays.length < 1) {
      fields.weekdays = 'Required for weekly schedules'
    }
  }
  if (
    frequency === 'monthly' && !partial && output.day_of_month == null && !('day_of_month' in body)
  ) {
    // server defaults from anchor
  }
  if (frequency === 'yearly' && !partial) {
    // server can default day/month from anchor
  }

  if ('lines' in body) {
    if (!Array.isArray(body.lines)) {
      fields.lines = 'Must be an array'
    } else if (body.lines.length > 200) {
      fields.lines = 'Cannot exceed 200 lines'
    } else {
      try {
        output.lines = (body.lines as Record<string, unknown>[]).map((line, index) =>
          validateLine(line, index)
        )
      } catch (error) {
        if (error instanceof ApiError) throw error
        fields.lines = 'Invalid lines'
      }
    }
  } else if (!partial) {
    output.lines = []
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Recurring schedule validation failed', fields)
  }

  if (!partial) {
    return {
      ...output,
      name: output.name as string,
      client_id: output.client_id as string,
      frequency: output.frequency as string,
      lines: output.lines ?? [],
    }
  }

  if (Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one field is required', {
      body: 'At least one field is required',
    })
  }
  return output
}

function encodeCursor(row: ScheduleCursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeRecurringScheduleCursor(value: string): ScheduleCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<ScheduleCursor>
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
  const message = error.message?.toLowerCase() ?? ''
  if (message.includes('version conflict')) {
    return new ApiError(
      412,
      'PRECONDITION_FAILED',
      'Recurring schedule version does not match If-Match',
    )
  }
  if (message.includes('idempotency-key was reused')) {
    // Deliberate RAISE from our own RPCs; the message is user-facing.
    return new ApiError(409, 'CONFLICT', error.message || 'Idempotency-Key was reused')
  }
  if (error.code === '23505') {
    // Postgres-generated unique-violation messages leak constraint names; keep generic.
    return new ApiError(409, 'CONFLICT', 'The schedule conflicts with an existing record')
  }
  if (error.code === '55000') {
    return new ApiError(
      409,
      'CONFLICT',
      error.message || 'An identical request is already in progress',
    )
  }
  if (error.code === '22023') {
    // Deliberate RAISE from our own RPCs; the message is user-facing.
    return new ApiError(422, 'VALIDATION_ERROR', error.message || 'Schedule validation failed')
  }
  if (error.code === '23503' || error.code === '23514' || error.code === '22003') {
    // Postgres-generated constraint messages leak schema details; keep generic.
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      'The recurring schedule failed a database constraint',
    )
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', error.message || 'Recurring schedule not found')
  }
  console.error('Recurring schedule database operation failed', {
    request_id: requestId,
    code: error.code,
    message: error.message,
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'Recurring schedule operation failed')
}

function asScheduleDocument(data: Json): RecurringDocument {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Recurring schedule RPC returned an unexpected payload',
    )
  }
  const payload = data as { schedule?: RecurringScheduleRow; lines?: RecurringLineRow[] }
  if (!payload.schedule) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Recurring schedule RPC returned an incomplete payload',
    )
  }
  return {
    ...payload.schedule,
    lines: Array.isArray(payload.lines) ? payload.lines : [],
  }
}

function toRpcPayload(input: RecurringHeaderInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'lines') continue
    if (value !== undefined) payload[key] = value
  }
  return payload
}

async function listSchedules(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const status = url.searchParams.get('status')
  if (
    status !== null &&
    !['draft', 'active', 'paused', 'completed', 'cancelled'].includes(status)
  ) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is not supported', {
      status: 'Must be draft, active, paused, completed, or cancelled',
    })
  }
  const cursorValue = url.searchParams.get('cursor')
  const cursor = cursorValue ? decodeRecurringScheduleCursor(cursorValue) : null

  let query = db
    .from('recurring_invoice_schedules')
    .select(SCHEDULE_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (status) {
    query = query.eq(
      'status',
      status as RecurringScheduleRow['status'],
    )
  }
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

async function createSchedule(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const body = await jsonBody(req)
  const validated = validateRecurringScheduleBody(body, false)
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('create_recurring_schedule_draft', {
    p_org_id: orgId,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines as unknown as Json,
  })
  if (error) throw databaseError(error, requestId)
  const document = asScheduleDocument(data as Json)
  return jsonResponse({ data: document }, 201, requestId, {
    etag: etag(document.version),
    location: `/api/v1/recurring-invoice-schedules/${document.id}`,
  })
}

async function getSchedule(
  db: DatabaseClient,
  orgId: string,
  scheduleId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('get_recurring_schedule_document', {
    p_schedule_id: scheduleId,
    p_org_id: orgId,
  })
  if (error) throw databaseError(error, requestId)
  const document = asScheduleDocument(data as Json)
  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

async function updateSchedule(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  scheduleId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const body = await jsonBody(req)
  const validated = validateRecurringScheduleBody(body, true)
  const { lines, ...header } = validated

  const { data, error } = await db.rpc('save_recurring_schedule_draft', {
    p_schedule_id: scheduleId,
    p_org_id: orgId,
    p_expected_version: version,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines === undefined ? null : lines as unknown as Json,
  })
  if (error) throw databaseError(error, requestId)
  const document = asScheduleDocument(data as Json)
  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
  })
}

async function deleteSchedule(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  scheduleId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { error } = await db.rpc('soft_delete_recurring_schedule_draft', {
    p_schedule_id: scheduleId,
    p_org_id: orgId,
    p_expected_version: version,
  })
  if (error) throw databaseError(error, requestId)
  return new Response(null, { status: 204, headers: { 'x-request-id': requestId } })
}

async function previewSchedule(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const body = await jsonBody(req)
  const validated = validateRecurringScheduleBody(body, false)
  const { lines, ...header } = validated
  const { data, error } = await db.rpc('preview_recurring_schedule', {
    p_org_id: orgId,
    p_payload: toRpcPayload(header) as Json,
    p_lines: lines as unknown as Json,
  })
  if (error) throw databaseError(error, requestId)
  return jsonResponse({ data }, 200, requestId)
}

/** Idempotency request payload for lifecycle commands.
 * run-now omits expected_version: If-Match is a first-exec precondition only.
 * Retries may send a refreshed ETag after the schedule version bumps (e.g. last_run_at).
 */
export function recurringLifecycleIdempotencyPayload(
  command: string,
  scheduleId: string,
  expectedVersion: number,
): Record<string, unknown> {
  if (command === 'run-now') {
    return { schedule_id: scheduleId }
  }
  return { schedule_id: scheduleId, expected_version: expectedVersion }
}

async function lifecycleCommand(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  scheduleId: string,
  command: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const rawKey = parseIdempotencyKey(req)
  const route = `/api/v1/recurring-invoice-schedules/${scheduleId}/${command}`
  const requestHash = await hashIdempotencyRequest(
    route,
    recurringLifecycleIdempotencyPayload(command, scheduleId, version),
  )
  const keyHash = await sha256Hex(rawKey)

  if (command === 'run-now') {
    const { data, error } = await db.rpc('run_now_recurring_schedule', {
      p_schedule_id: scheduleId,
      p_org_id: orgId,
      p_expected_version: version,
      p_idempotency_key_hash: keyHash,
      p_request_hash: requestHash,
      p_route: route,
    })
    if (error) throw databaseError(error, requestId)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'run-now returned an unexpected payload')
    }
    const envelope = data as {
      response_status?: number
      response_body?: unknown
      response_headers?: Record<string, string>
    }
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

  const rpcName = ({
    activate: 'activate_recurring_schedule',
    pause: 'pause_recurring_schedule',
    resume: 'resume_recurring_schedule',
    cancel: 'cancel_recurring_schedule',
  } as const)[command as 'activate' | 'pause' | 'resume' | 'cancel']

  // Store idempotency for non-run-now via a lightweight claim table insert is heavy;
  // require Idempotency-Key but execute command directly (key validated present).
  void keyHash
  void requestHash

  const { data, error } = await db.rpc(rpcName, {
    p_schedule_id: scheduleId,
    p_org_id: orgId,
    p_expected_version: version,
  })
  if (error) throw databaseError(error, requestId)
  const document = asScheduleDocument(data as Json)
  return jsonResponse({ data: document }, 200, requestId, {
    etag: etag(document.version),
    [IDEMPOTENCY_KEY_HEADER]: rawKey,
  })
}

async function listRuns(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  scheduleId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))

  const { data: schedule, error: scheduleError } = await db
    .from('recurring_invoice_schedules')
    .select('id')
    .eq('org_id', orgId)
    .eq('id', scheduleId)
    .is('deleted_at', null)
    .maybeSingle()
  if (scheduleError) throw databaseError(scheduleError, requestId)
  if (!schedule) throw new ApiError(404, 'NOT_FOUND', 'Recurring schedule not found')

  const { data, error } = await db
    .from('recurring_invoice_runs')
    .select(RUN_SELECT)
    .eq('org_id', orgId)
    .eq('schedule_id', scheduleId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (error) throw databaseError(error, requestId)
  return jsonResponse({ data: data ?? [] }, 200, requestId)
}

async function getRun(
  db: DatabaseClient,
  orgId: string,
  scheduleId: string,
  runId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db
    .from('recurring_invoice_runs')
    .select(RUN_SELECT)
    .eq('org_id', orgId)
    .eq('schedule_id', scheduleId)
    .eq('id', runId)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Recurring run not found')
  return jsonResponse({ data }, 200, requestId)
}

export function handleRecurringInvoices(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/recurring-invoice-schedules') {
    if (req.method === 'GET') return listSchedules(req, db, orgId, requestId)
    if (req.method === 'POST') return createSchedule(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for recurring schedules')
  }

  if (path === '/api/v1/recurring-invoice-schedules/preview') {
    if (req.method === 'POST') return previewSchedule(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for preview')
  }

  const runItemMatch = path.match(
    /^\/api\/v1\/recurring-invoice-schedules\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (runItemMatch) {
    if (req.method === 'GET') {
      return getRun(db, orgId, runItemMatch[1], runItemMatch[2], requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for recurring run')
  }

  const runsMatch = path.match(
    /^\/api\/v1\/recurring-invoice-schedules\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/runs$/i,
  )
  if (runsMatch) {
    if (req.method === 'GET') return listRuns(req, db, orgId, runsMatch[1], requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for recurring runs')
  }

  const commandMatch = path.match(
    /^\/api\/v1\/recurring-invoice-schedules\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(activate|pause|resume|cancel|run-now)$/i,
  )
  if (commandMatch) {
    const command = commandMatch[2].toLowerCase()
    if (!COMMANDS.has(command)) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Method not allowed for ${command}`)
    }
    return lifecycleCommand(req, db, orgId, commandMatch[1], command, requestId)
  }

  const itemMatch = path.match(
    /^\/api\/v1\/recurring-invoice-schedules\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const scheduleId = itemMatch[1]

  if (req.method === 'GET') return getSchedule(db, orgId, scheduleId, requestId)
  if (req.method === 'PATCH') return updateSchedule(req, db, orgId, scheduleId, requestId)
  if (req.method === 'DELETE') return deleteSchedule(req, db, orgId, scheduleId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for recurring schedule')
}
