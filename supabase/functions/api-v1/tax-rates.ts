import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, MembershipRow, TaxRateRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

type DatabaseClient = SupabaseClient<Database>

const SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,rate_percent,is_default,active'

function hasAtMostFourDecimals(value: number): boolean {
  return Math.abs(value * 1e4 - Math.round(value * 1e4)) < 1e-6
}

type TaxRateCreate = {
  name: string
  rate_percent: number
  is_default: boolean
  active: boolean
}
type TaxRateUpdate = Partial<TaxRateCreate>

export function validateTaxRateBody(
  body: Record<string, unknown>,
  partial: false,
): TaxRateCreate
export function validateTaxRateBody(
  body: Record<string, unknown>,
  partial: true,
): TaxRateUpdate
export function validateTaxRateBody(
  body: Record<string, unknown>,
  partial: boolean,
): TaxRateCreate | TaxRateUpdate {
  const fields: Record<string, string> = {}
  const writable = new Set(['name', 'rate_percent', 'is_default', 'active'])
  const output: Record<string, unknown> = {}

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Unknown field'
  }
  if ('org_id' in body) fields.org_id = 'Must not be supplied in the request body'

  if (partial) {
    const hasWritableField = Object.keys(body).some((key) => writable.has(key))
    if (!hasWritableField) {
      fields._ = 'At least one field is required'
    }
  }

  if ('name' in body) {
    const value = body.name
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
      fields.name = 'Must be a non-empty string up to 120 characters'
    } else {
      output.name = value.trim()
    }
  } else if (!partial) {
    fields.name = 'Required'
  }

  if ('rate_percent' in body) {
    const value = body.rate_percent
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100 ||
      !hasAtMostFourDecimals(value)
    ) {
      fields.rate_percent = 'Must be a finite number from 0 to 100 with at most 4 decimals'
    } else {
      output.rate_percent = value
    }
  } else if (!partial) {
    fields.rate_percent = 'Required'
  }

  if ('is_default' in body) {
    if (typeof body.is_default !== 'boolean') {
      fields.is_default = 'Must be a boolean'
    } else {
      output.is_default = body.is_default
    }
  } else if (!partial) {
    output.is_default = false
  }

  if ('active' in body) {
    if (typeof body.active !== 'boolean') {
      fields.active = 'Must be a boolean'
    } else {
      output.active = body.active
    }
  } else if (!partial) {
    output.active = true
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Tax rate validation failed', fields)
  }

  return output as TaxRateCreate | TaxRateUpdate
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  if (error.code === '23505') {
    return new ApiError(
      409,
      'CONFLICT',
      'Only one active default tax rate is allowed per organisation',
    )
  }
  if (error.code === '23514') {
    if (error.message?.includes('while products reference')) {
      return new ApiError(
        422,
        'VALIDATION_ERROR',
        'Cannot deactivate or archive a tax rate while products reference it',
        { tax_rate_id: 'Referenced by one or more products' },
      )
    }
    return new ApiError(422, 'VALIDATION_ERROR', 'Tax rate failed a database constraint')
  }
  console.error('Tax rate operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The tax rate operation failed')
}

async function findTaxRate(
  db: DatabaseClient,
  orgId: string,
  taxRateId: string,
  requestId: string,
): Promise<TaxRateRow> {
  const { data, error } = await db
    .from('tax_rates')
    .select(SELECT)
    .eq('org_id', orgId)
    .eq('id', taxRateId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Tax rate not found')
  return data
}

export function handleTaxRates(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRow['role'],
  requestId: string,
): Promise<Response> {
  const canMutate = role === 'owner' || role === 'admin'

  if (path === '/api/v1/tax-rates') {
    if (req.method === 'GET') {
      return (async () => {
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        const { data, error } = await db
          .from('tax_rates')
          .select(SELECT)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit)
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data: data ?? [] }, 200, requestId)
      })()
    }
    if (req.method === 'POST') {
      if (!canMutate) {
        throw new ApiError(403, 'FORBIDDEN', 'Only owners and admins can manage tax rates')
      }
      return (async () => {
        const payload = validateTaxRateBody(await jsonBody(req), false)
        const { data, error } = await db
          .from('tax_rates')
          .insert(
            {
              ...payload,
              org_id: orgId,
            } as Database['public']['Tables']['tax_rates']['Insert'],
          )
          .select(SELECT)
          .single()
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data }, 201, requestId, {
          etag: etag(data.version),
          location: `/api/v1/tax-rates/${data.id}`,
        })
      })()
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for tax rates')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/tax-rates\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const taxRateId = parseUuid(itemMatch[1], 'id')

  if (req.method === 'GET') {
    return findTaxRate(db, orgId, taxRateId, requestId).then((data) =>
      jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    )
  }

  if (req.method === 'PATCH') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'Only owners and admins can manage tax rates')
    }
    return (async () => {
      const version = parseVersion(req)
      const current = await findTaxRate(db, orgId, taxRateId, requestId)
      if (current.version !== version) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Tax rate version does not match If-Match')
      }
      const payload = validateTaxRateBody(await jsonBody(req), true)
      const { data, error } = await db
        .from('tax_rates')
        .update(payload)
        .eq('org_id', orgId)
        .eq('id', taxRateId)
        .eq('version', version)
        .is('deleted_at', null)
        .select(SELECT)
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Tax rate version does not match If-Match')
      }
      return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    })()
  }

  if (req.method === 'DELETE') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'Only owners and admins can manage tax rates')
    }
    return (async () => {
      const version = parseVersion(req)
      const current = await findTaxRate(db, orgId, taxRateId, requestId)
      if (current.version !== version) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Tax rate version does not match If-Match')
      }
      const { data, error } = await db
        .from('tax_rates')
        .update({ deleted_at: new Date().toISOString(), is_default: false, active: false })
        .eq('org_id', orgId)
        .eq('id', taxRateId)
        .eq('version', version)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Tax rate version does not match If-Match')
      }
      return new Response(null, {
        status: 204,
        headers: { 'x-request-id': requestId },
      })
    })()
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for tax rates')
}
