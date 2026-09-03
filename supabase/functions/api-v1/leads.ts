import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, LeadRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const LEAD_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,company_name,primary_email,contact_id,client_id,stage,value_cents,currency,probability_percent,source,owner_membership_id,expected_close_on,lost_reason,won_at,lost_at,converted_at,position,notes,metadata'

const WRITABLE_FIELDS = new Set([
  'name',
  'company_name',
  'primary_email',
  'contact_id',
  'client_id',
  'stage',
  'value_cents',
  'currency',
  'probability_percent',
  'source',
  'owner_membership_id',
  'expected_close_on',
  'lost_reason',
  'position',
  'notes',
  'metadata',
])

const NULLABLE_TEXT_FIELDS = [
  'company_name',
  'primary_email',
  'source',
  'lost_reason',
  'notes',
] as const

const TEXT_LIMITS: Record<(typeof NULLABLE_TEXT_FIELDS)[number], number> = {
  company_name: 200,
  primary_email: 320,
  source: 120,
  lost_reason: 2000,
  notes: 20_000,
}

const STAGES = new Set(['new', 'qualified', 'proposal', 'won', 'lost'])
const WRITABLE_STAGES = new Set(['new', 'qualified', 'proposal', 'lost'])

type DatabaseClient = SupabaseClient<Database>
type LeadStage = LeadRow['stage']
type LeadWritable = {
  name?: string
  company_name?: string | null
  primary_email?: string | null
  contact_id?: string | null
  client_id?: string | null
  stage?: LeadStage
  value_cents?: number | null
  currency?: string
  probability_percent?: number | null
  source?: string | null
  owner_membership_id?: string | null
  expected_close_on?: string | null
  lost_reason?: string | null
  position?: number
  notes?: string | null
  metadata?: Json
  lost_at?: string | null
}
type LeadCreate = LeadWritable & { name: string; currency: string; stage: LeadStage }
type LeadUpdate = LeadWritable

interface LeadCursor {
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

/** Matches Postgres `numeric(20, 10)`: 10 digits before the decimal, 10 after. */
const POSITION_ABS_LIMIT = 10_000_000_000

function isValidLeadPosition(value: number): boolean {
  if (!Number.isFinite(value) || Math.abs(value) >= POSITION_ABS_LIMIT) return false
  const scaled = value * 1e10
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

export function validateLeadBody(
  body: Record<string, unknown>,
  partial: false,
  options?: { defaultCurrency?: string },
): LeadCreate
export function validateLeadBody(
  body: Record<string, unknown>,
  partial: true,
  options?: { defaultCurrency?: string },
): LeadUpdate
export function validateLeadBody(
  body: Record<string, unknown>,
  partial: boolean,
  options: { defaultCurrency?: string } = {},
): LeadCreate | LeadUpdate {
  const fields: Record<string, string> = {}
  const output: LeadUpdate = {}
  const defaultCurrency = options.defaultCurrency ?? 'GBP'

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

  if ('contact_id' in body) {
    const value = body.contact_id
    if (value === null) {
      output.contact_id = null
    } else {
      try {
        output.contact_id = parseUuid(typeof value === 'string' ? value : null, 'contact_id')
      } catch {
        fields.contact_id = 'Must be a UUID or null'
      }
    }
  }

  if ('client_id' in body) {
    const value = body.client_id
    if (value === null) {
      output.client_id = null
    } else {
      try {
        output.client_id = parseUuid(typeof value === 'string' ? value : null, 'client_id')
      } catch {
        fields.client_id = 'Must be a UUID or null'
      }
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

  if ('stage' in body) {
    const value = body.stage
    if (typeof value !== 'string' || !STAGES.has(value)) {
      fields.stage = 'Must be new, qualified, proposal, won, or lost'
    } else if (value === 'won') {
      fields.stage = 'Use POST /api/v1/leads/{id}/convert to mark a lead as won'
    } else if (!WRITABLE_STAGES.has(value)) {
      fields.stage = 'Must be new, qualified, proposal, or lost'
    } else {
      output.stage = value as LeadStage
    }
  } else if (!partial) {
    output.stage = 'new'
  }

  if ('currency' in body) {
    const value = body.currency
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      fields.currency = 'Must be a 3-letter uppercase ISO currency code'
    } else {
      output.currency = value
    }
  } else if (!partial) {
    output.currency = defaultCurrency
  }

  if ('value_cents' in body) {
    const value = body.value_cents
    if (
      value !== null &&
      (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    ) {
      fields.value_cents = 'Must be a non-negative safe integer or null'
    } else {
      output.value_cents = value as number | null
    }
  }

  if ('probability_percent' in body) {
    const value = body.probability_percent
    const withinScale = typeof value === 'number' &&
      Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
    if (
      value !== null &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100 ||
        !withinScale)
    ) {
      fields.probability_percent =
        'Must be a number between 0 and 100 with at most 2 decimal places, or null'
    } else {
      output.probability_percent = value as number | null
    }
  }

  if ('expected_close_on' in body) {
    const value = body.expected_close_on
    if (value === null) {
      output.expected_close_on = null
    } else if (typeof value !== 'string' || !isValidDateOnly(value)) {
      fields.expected_close_on = 'Must be a real YYYY-MM-DD date or null'
    } else {
      output.expected_close_on = value
    }
  }

  if ('position' in body) {
    const value = body.position
    if (typeof value !== 'number' || !isValidLeadPosition(value)) {
      fields.position =
        'Must fit numeric(20,10): finite, |value| < 10000000000, at most 10 decimal places'
    } else {
      output.position = value
    }
  } else if (!partial) {
    output.position = 0
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

  const stage = output.stage
  if (stage === 'lost') {
    const reason = 'lost_reason' in output ? output.lost_reason : undefined
    if (reason == null || reason.trim() === '') {
      fields.lost_reason = 'Required when stage is lost'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Lead validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as LeadCreate | LeadUpdate
}

function encodeCursor(lead: LeadCursor): string {
  return btoa(JSON.stringify({ created_at: lead.created_at, id: lead.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeLeadCursor(value: string): LeadCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<LeadCursor>
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
    return new ApiError(412, 'PRECONDITION_FAILED', 'Lead version does not match If-Match')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The lead conflicts with an existing record')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '23514' || error.code === '22023' || error.code === '22003') {
    return new ApiError(422, 'VALIDATION_ERROR', 'The lead failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Lead not found')
  }
  console.error('Lead database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The lead operation failed')
}

function applyLostStageSideEffects<T extends LeadUpdate>(
  payload: T,
  currentStage?: LeadStage,
): T & { lost_at?: string | null } {
  if (payload.stage === 'lost') {
    return { ...payload, lost_at: new Date().toISOString() }
  }
  if (payload.stage && currentStage === 'lost') {
    return {
      ...payload,
      lost_at: null,
      lost_reason: payload.lost_reason ?? null,
    }
  }
  return payload
}

/** Resolve omitted currency: client default → organisation default. */
export function resolveLeadCurrency(options: {
  explicit?: string
  clientDefault?: string | null
  orgDefault: string
}): string {
  if (options.explicit) return options.explicit
  if (
    typeof options.clientDefault === 'string' &&
    /^[A-Z]{3}$/.test(options.clientDefault)
  ) {
    return options.clientDefault
  }
  return options.orgDefault
}

async function findActiveClient(
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<{ id: string; default_currency: string | null }> {
  const { data, error } = await db
    .from('clients')
    .select('id, default_currency')
    .eq('org_id', orgId)
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Lead validation failed', {
      client_id: 'Must reference an active client in this organisation',
    })
  }
  return data
}

async function listLeads(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const stage = url.searchParams.get('stage')
  if (stage && !STAGES.has(stage)) {
    throw new ApiError(400, 'BAD_REQUEST', 'stage is invalid')
  }
  const tagIdRaw = url.searchParams.get('tag_id')
  let tagEntityIds: string[] | null = null
  if (tagIdRaw) {
    const tagId = parseUuid(tagIdRaw, 'tag_id')
    const { data: assignments, error: tagError } = await db
      .from('tag_assignments')
      .select('entity_id')
      .eq('org_id', orgId)
      .eq('tag_id', tagId)
      .eq('entity_type', 'lead')
    if (tagError) throw databaseError(tagError, requestId)
    tagEntityIds = (assignments ?? []).map((row) => row.entity_id)
    if (tagEntityIds.length === 0) {
      return jsonResponse({ data: [], meta: { next_cursor: null } }, 200, requestId)
    }
  }

  let query = db
    .from('leads')
    .select(LEAD_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (stage) {
    query = query.eq('stage', stage as LeadStage)
  }
  if (tagEntityIds) {
    query = query.in('id', tagEntityIds)
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeLeadCursor(cursorValue)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const leads = data ?? []
  const hasNextPage = leads.length > limit
  const page = hasNextPage ? leads.slice(0, limit) : leads
  const lastLead = page.at(-1) as LeadCursor | undefined

  return jsonResponse(
    {
      data: page,
      meta: {
        next_cursor: hasNextPage && lastLead ? encodeCursor(lastLead) : null,
      },
    },
    200,
    requestId,
  )
}

async function createLead(
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
  // Validate shape first so UUID errors surface as field validation.
  const draft = validateLeadBody(body, false, {
    defaultCurrency: organisation.default_currency ?? 'GBP',
  })

  let clientDefault: string | null = null
  if (draft.client_id) {
    clientDefault = (await findActiveClient(db, orgId, draft.client_id, requestId))
      .default_currency
  }

  if (!('currency' in body)) {
    draft.currency = resolveLeadCurrency({
      clientDefault,
      orgDefault: organisation.default_currency ?? 'GBP',
    })
  }

  const payload = applyLostStageSideEffects(draft)
  const { data, error } = await db
    .from('leads')
    .insert({ ...payload, org_id: orgId } as Database['public']['Tables']['leads']['Insert'])
    .select(LEAD_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/leads/${data.id}`,
  })
}

async function findLead(
  db: DatabaseClient,
  orgId: string,
  leadId: string,
  requestId: string,
): Promise<LeadRow> {
  const { data, error } = await db
    .from('leads')
    .select(LEAD_SELECT)
    .eq('org_id', orgId)
    .eq('id', leadId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
  return data
}

async function getLead(
  db: DatabaseClient,
  orgId: string,
  leadId: string,
  requestId: string,
): Promise<Response> {
  const data = await findLead(db, orgId, leadId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateLead(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  leadId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findLead(db, orgId, leadId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Lead version does not match If-Match')
  }
  if (current.stage === 'won') {
    throw new ApiError(
      409,
      'CONFLICT',
      'Converted leads cannot be edited; update the client instead',
    )
  }

  const body = await jsonBody(req)
  const draft = applyLostStageSideEffects(
    validateLeadBody(body, true),
    current.stage,
  )

  if (draft.client_id) {
    const client = await findActiveClient(db, orgId, draft.client_id, requestId)
    if (!('currency' in body)) {
      const { data: organisation, error: orgError } = await db
        .from('organisations')
        .select('default_currency')
        .eq('id', orgId)
        .is('deleted_at', null)
        .maybeSingle()
      if (orgError) throw databaseError(orgError, requestId)
      if (!organisation) throw new ApiError(404, 'NOT_FOUND', 'Organisation not found')

      draft.currency = resolveLeadCurrency({
        clientDefault: client.default_currency,
        orgDefault: organisation.default_currency ?? 'GBP',
      })
    }
  }

  const { data, error } = await db
    .from('leads')
    .update(draft)
    .eq('org_id', orgId)
    .eq('id', leadId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(LEAD_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Lead changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteLead(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  leadId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  // Direct UPDATE ... deleted_at hits RLS 42501 for authenticated callers on
  // staging; mutate through the security-definer RPC (same pattern as contacts).
  const { error } = await db.rpc('soft_delete_lead', {
    p_lead_id: leadId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

function validateConvertBody(body: Record<string, unknown>): {
  client_name?: string
  client_status?: string
} {
  const fields: Record<string, string> = {}
  const output: { client_name?: string; client_status?: string } = {}

  for (const key of Object.keys(body)) {
    if (key !== 'client_name' && key !== 'client_status') {
      fields[key] = 'Field is not writable'
    }
  }

  if ('client_name' in body) {
    const value = body.client_name
    if (value !== null && typeof value !== 'string') {
      fields.client_name = 'Must be a string or null'
    } else if (typeof value === 'string' && value.trim().length > 200) {
      fields.client_name = 'Must not exceed 200 characters'
    } else if (typeof value === 'string' && value.trim().length > 0) {
      output.client_name = value.trim()
    }
  }

  if ('client_status' in body) {
    const value = body.client_status
    const allowed = new Set(['prospect', 'active', 'on_hold', 'inactive', 'archived'])
    if (typeof value !== 'string' || !allowed.has(value)) {
      fields.client_status = 'Must be prospect, active, on_hold, inactive, or archived'
    } else {
      output.client_status = value
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Lead conversion validation failed', fields)
  }
  return output
}

async function convertLead(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  leadId: string,
  requestId: string,
): Promise<Response> {
  await findLead(db, orgId, leadId, requestId)

  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  const rawBody = await req.text()
  let payload: { client_name?: string; client_status?: string } = {}
  if (rawBody.trim().length > 0) {
    if (!contentType.startsWith('application/json')) {
      throw new ApiError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Content-Type must be application/json',
      )
    }
    if (new TextEncoder().encode(rawBody).byteLength > 65_536) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64 KiB')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw new ApiError(400, 'BAD_REQUEST', 'Request body is not valid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'BAD_REQUEST', 'Request body must be a JSON object')
    }
    payload = validateConvertBody(parsed as Record<string, unknown>)
  }

  const { data, error } = await db.rpc('convert_lead', {
    p_lead_id: leadId,
    p_client_name: payload.client_name ?? undefined,
    p_client_status: payload.client_status ?? undefined,
  })

  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Lead conversion returned an unexpected payload')
  }

  const result = data as { lead?: LeadRow; client?: unknown; idempotent?: boolean }
  if (!result.lead || !result.client) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Lead conversion returned an incomplete payload')
  }

  return jsonResponse(
    {
      data: {
        lead: result.lead,
        client: result.client,
        idempotent: Boolean(result.idempotent),
      },
    },
    result.idempotent ? 200 : 201,
    requestId,
    {
      etag: etag(result.lead.version),
      location: `/api/v1/clients/${(result.client as { id: string }).id}`,
    },
  )
}

export function handleLeads(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/leads') {
    if (req.method === 'GET') return listLeads(req, db, orgId, requestId)
    if (req.method === 'POST') return createLead(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for leads')
  }

  const convertMatch = path.match(
    /^\/api\/v1\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/convert$/i,
  )
  if (convertMatch) {
    if (req.method === 'POST') {
      return convertLead(req, db, orgId, convertMatch[1], requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for lead conversion')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const leadId = itemMatch[1]
  if (req.method === 'GET') return getLead(db, orgId, leadId, requestId)
  if (req.method === 'PATCH') return updateLead(req, db, orgId, leadId, requestId)
  if (req.method === 'DELETE') return deleteLead(req, db, orgId, leadId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for lead')
}
