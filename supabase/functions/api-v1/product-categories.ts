import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ProductCategoryRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,description,position'

type DatabaseClient = SupabaseClient<Database>
type Writable = {
  name?: string
  description?: string | null
  position?: number
}
type Create = Writable & { name: string }
type Update = Writable

interface Cursor {
  created_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

export function validateProductCategoryBody(
  body: Record<string, unknown>,
  partial: false,
): Create
export function validateProductCategoryBody(
  body: Record<string, unknown>,
  partial: true,
): Update
export function validateProductCategoryBody(
  body: Record<string, unknown>,
  partial: boolean,
): Create | Update {
  const fields: Record<string, string> = {}
  const output: Update = {}
  const writable = new Set(['name', 'description', 'position'])

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'name' in body) {
    const value = body.name
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 120) {
      fields.name = 'Must be a string between 1 and 120 characters'
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

  if ('position' in body) {
    const value = body.position
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < -2_147_483_648 ||
      value > 2_147_483_647
    ) {
      fields.position = 'Must be a 32-bit integer'
    } else {
      output.position = value
    }
  } else if (!partial) {
    output.position = 0
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Product category validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }
  return output as Create | Update
}

function encodeCursor(row: Cursor): string {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function decodeCursor(value: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<Cursor>
    const createdAt = cursor.created_at
    const id = parseUuid(cursor.id ?? null, 'cursor')
    if (
      typeof createdAt !== 'string' ||
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
    return new ApiError(409, 'CONFLICT', 'The product category conflicts with an existing record')
  }
  if (error.code === '23503' || error.code === '23514' || error.code === '22023') {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      'The product category failed a database constraint',
    )
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  console.error('Product category database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The product category operation failed')
}

async function findCategory(
  db: DatabaseClient,
  orgId: string,
  categoryId: string,
  requestId: string,
): Promise<ProductCategoryRow> {
  const { data, error } = await db
    .from('product_categories')
    .select(SELECT)
    .eq('org_id', orgId)
    .eq('id', categoryId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Product category not found')
  return data
}

export function handleProductCategories(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/product-categories') {
    if (req.method === 'GET') {
      return (async () => {
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        let query = db
          .from('product_categories')
          .select(SELECT)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit + 1)
        const cursorValue = url.searchParams.get('cursor')
        if (cursorValue) {
          const cursor = decodeCursor(cursorValue)
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
        const payload = validateProductCategoryBody(await jsonBody(req), false)
        const { data, error } = await db
          .from('product_categories')
          .insert({ ...payload, org_id: orgId })
          .select(SELECT)
          .single()
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data }, 201, requestId, {
          etag: etag(data.version),
          location: `/api/v1/product-categories/${data.id}`,
        })
      })()
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for product categories')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/product-categories\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const categoryId = itemMatch[1]

  if (req.method === 'GET') {
    return findCategory(db, orgId, categoryId, requestId).then((data) =>
      jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    )
  }
  if (req.method === 'PATCH') {
    return (async () => {
      const version = parseVersion(req)
      const current = await findCategory(db, orgId, categoryId, requestId)
      if (current.version !== version) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Product category version does not match If-Match',
        )
      }
      const payload = validateProductCategoryBody(await jsonBody(req), true)
      const { data, error } = await db
        .from('product_categories')
        .update(payload)
        .eq('org_id', orgId)
        .eq('id', categoryId)
        .eq('version', version)
        .is('deleted_at', null)
        .select(SELECT)
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Product category changed during this request',
        )
      }
      return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    })()
  }
  if (req.method === 'DELETE') {
    return (async () => {
      const version = parseVersion(req)
      const current = await findCategory(db, orgId, categoryId, requestId)
      if (current.version !== version) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Product category version does not match If-Match',
        )
      }
      const { data, error } = await db
        .from('product_categories')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', categoryId)
        .eq('version', version)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Product category changed during this request',
        )
      }
      return new Response(null, { status: 204, headers: { 'x-request-id': requestId } })
    })()
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for product category')
}
