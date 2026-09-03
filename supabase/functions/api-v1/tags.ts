import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, MembershipRow } from '../_shared/database.ts'
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
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,color'

const ENTITY_PATH: Record<string, 'lead' | 'contact' | 'client'> = {
  leads: 'lead',
  contacts: 'contact',
  clients: 'client',
}

type TagCreate = { name: string; color?: string | null }
type TagUpdate = Partial<TagCreate>

export function validateTagBody(
  body: Record<string, unknown>,
  partial: false,
): TagCreate
export function validateTagBody(
  body: Record<string, unknown>,
  partial: true,
): TagUpdate
export function validateTagBody(
  body: Record<string, unknown>,
  partial: boolean,
): TagCreate | TagUpdate {
  const fields: Record<string, string> = {}
  const writable = new Set(['name', 'color'])
  const output: Record<string, unknown> = {}

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Unknown field'
  }
  if ('org_id' in body) fields.org_id = 'Must not be supplied in the request body'

  if (partial) {
    const hasWritableField = Object.keys(body).some((key) => writable.has(key))
    if (!hasWritableField) fields._ = 'At least one field is required'
  }

  if ('name' in body) {
    const value = body.name
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
      fields.name = 'Must be a non-empty string up to 80 characters'
    } else {
      output.name = value.trim()
    }
  } else if (!partial) {
    fields.name = 'Required'
  }

  if ('color' in body) {
    if (body.color === null || body.color === undefined || body.color === '') {
      output.color = null
    } else if (typeof body.color !== 'string' || body.color.trim().length > 32) {
      fields.color = 'Must be a string up to 32 characters or null'
    } else {
      output.color = body.color.trim()
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Tag validation failed', fields)
  }
  return output as TagCreate | TagUpdate
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (message.includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Tag version does not match If-Match')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'A tag with this name already exists')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', error.message || 'Tag failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Tag not found')
  }
  console.error('Tag operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The tag operation failed')
}

async function findTag(
  db: DatabaseClient,
  orgId: string,
  tagId: string,
  requestId: string,
) {
  const { data, error } = await db
    .from('tags')
    .select(SELECT)
    .eq('org_id', orgId)
    .eq('id', tagId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Tag not found')
  return data
}

export function handleTags(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRow['role'],
  requestId: string,
): Promise<Response> {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access tags')
  }
  const canMutate = role === 'owner' || role === 'admin' || role === 'member'

  const entityTagsMatch = path.match(
    /^\/api\/v1\/(contacts|leads|clients)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/tags$/i,
  )
  if (entityTagsMatch) {
    const entityType = ENTITY_PATH[entityTagsMatch[1]!]!
    const entityId = parseUuid(entityTagsMatch[2], 'id')

    if (req.method === 'GET') {
      return (async () => {
        const { data, error } = await db.rpc('list_entity_tags', {
          p_org_id: orgId,
          p_entity_type: entityType,
          p_entity_id: entityId,
        })
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data: data ?? [] }, 200, requestId)
      })()
    }

    if (req.method === 'PUT') {
      if (!canMutate) {
        throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage tags')
      }
      return (async () => {
        const body = await jsonBody(req)
        if (!Array.isArray(body.tag_ids)) {
          throw new ApiError(422, 'VALIDATION_ERROR', 'tag_ids must be an array', {
            tag_ids: 'Required array of tag ids',
          })
        }
        const tagIds = body.tag_ids.map((id, index) => {
          if (typeof id !== 'string') {
            throw new ApiError(422, 'VALIDATION_ERROR', 'tag_ids must be uuid strings', {
              [`tag_ids[${index}]`]: 'Must be a uuid',
            })
          }
          return parseUuid(id, `tag_ids[${index}]`)
        })
        const { data, error } = await db.rpc('replace_entity_tags', {
          p_org_id: orgId,
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_tag_ids: tagIds,
        })
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data: data ?? [] }, 200, requestId)
      })()
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for entity tags')
  }

  if (path === '/api/v1/tags') {
    if (req.method === 'GET') {
      return (async () => {
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        const { data, error } = await db
          .from('tags')
          .select(SELECT)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('name', { ascending: true })
          .order('id', { ascending: true })
          .limit(limit)
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data: data ?? [] }, 200, requestId)
      })()
    }
    if (req.method === 'POST') {
      if (!canMutate) {
        throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage tags')
      }
      return (async () => {
        const payload = validateTagBody(await jsonBody(req), false)
        const { data, error } = await db
          .from('tags')
          .insert({ ...payload, org_id: orgId })
          .select(SELECT)
          .single()
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data }, 201, requestId, {
          etag: etag(data.version),
          location: `/api/v1/tags/${data.id}`,
        })
      })()
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for tags')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/tags\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const tagId = parseUuid(itemMatch[1], 'id')

  if (req.method === 'GET') {
    return findTag(db, orgId, tagId, requestId).then((data) =>
      jsonResponse({ data }, 200, requestId, { etag: etag(data.version) }),
    )
  }

  if (req.method === 'PATCH') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage tags')
    }
    return (async () => {
      const version = parseVersion(req)
      const current = await findTag(db, orgId, tagId, requestId)
      if (current.version !== version) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Tag version does not match If-Match')
      }
      const payload = validateTagBody(await jsonBody(req), true)
      const { data, error } = await db
        .from('tags')
        .update(payload)
        .eq('org_id', orgId)
        .eq('id', tagId)
        .eq('version', version)
        .is('deleted_at', null)
        .select(SELECT)
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(412, 'PRECONDITION_FAILED', 'Tag version does not match If-Match')
      }
      return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    })()
  }

  if (req.method === 'DELETE') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage tags')
    }
    return (async () => {
      const version = parseVersion(req)
      const { error } = await db.rpc('soft_delete_tag', {
        p_tag_id: tagId,
        p_org_id: orgId,
        p_expected_version: version,
      })
      if (error) throw databaseError(error, requestId)
      return new Response(null, {
        status: 204,
        headers: { 'x-request-id': requestId },
      })
    })()
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for tag')
}

export function isEntityTagsPath(path: string): boolean {
  return /^\/api\/v1\/(contacts|leads|clients)\/[0-9a-f-]{36}\/tags$/i.test(path)
}

export function isTagsPath(path: string): boolean {
  return path === '/api/v1/tags' || path.startsWith('/api/v1/tags/') || isEntityTagsPath(path)
}
