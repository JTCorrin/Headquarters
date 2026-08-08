import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, MembershipRow, PlaybookRow } from '../_shared/database.ts'
import { defaultPlaybookGraphJson, validatePlaybookGraphJson } from '../_shared/playbook-graph.ts'
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
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,description,graph_json,is_active'

type PlaybookCreate = {
  name: string
  description?: string | null
  graph_json: PlaybookRow['graph_json']
  is_active?: boolean
}

type PlaybookUpdate = Partial<PlaybookCreate>

export function validatePlaybookBody(
  body: Record<string, unknown>,
  partial: false,
): PlaybookCreate
export function validatePlaybookBody(
  body: Record<string, unknown>,
  partial: true,
): PlaybookUpdate
export function validatePlaybookBody(
  body: Record<string, unknown>,
  partial: boolean,
): PlaybookCreate | PlaybookUpdate {
  const fields: Record<string, string> = {}
  const writable = new Set(['name', 'description', 'graph_json', 'is_active'])
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
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
      fields.name = 'Must be a non-empty string up to 200 characters'
    } else {
      output.name = value.trim()
    }
  } else if (!partial) {
    fields.name = 'Required'
  }

  if ('description' in body) {
    if (body.description === null) {
      output.description = null
    } else if (
      typeof body.description !== 'string' ||
      body.description.length > 2000
    ) {
      fields.description = 'Must be a string up to 2000 characters or null'
    } else {
      output.description = body.description
    }
  }

  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') {
      fields.is_active = 'Must be a boolean'
    } else {
      output.is_active = body.is_active
    }
  } else if (!partial) {
    output.is_active = false
  }

  if ('graph_json' in body) {
    const validated = validatePlaybookGraphJson(body.graph_json)
    if (!validated.ok) {
      fields.graph_json = validated.errors.join(' ')
    } else {
      output.graph_json = validated.graph
    }
  } else if (!partial) {
    output.graph_json = defaultPlaybookGraphJson()
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Playbook validation failed', fields)
  }

  return output as PlaybookCreate | PlaybookUpdate
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  if (error.message?.toLowerCase().includes('version conflict')) {
    return new ApiError(
      412,
      'PRECONDITION_FAILED',
      'Playbook version does not match If-Match',
    )
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'A playbook with this name already exists')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      error.message || 'Playbook failed a database constraint',
    )
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002' || error.message?.toLowerCase().includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Playbook not found')
  }
  console.error('Playbook operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The playbook operation failed')
}

async function findPlaybook(
  db: DatabaseClient,
  orgId: string,
  playbookId: string,
  requestId: string,
): Promise<PlaybookRow> {
  const { data, error } = await db
    .from('playbooks')
    .select(SELECT)
    .eq('org_id', orgId)
    .eq('id', playbookId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Playbook not found')
  return data as PlaybookRow
}

function canMutate(role: MembershipRow['role']): boolean {
  return role === 'owner' || role === 'admin' || role === 'member'
}

export function handlePlaybooks(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRow['role'],
  requestId: string,
): Promise<Response> {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access playbooks')
  }

  if (path === '/api/v1/playbooks') {
    if (req.method === 'GET') {
      return (async () => {
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        const activeParam = url.searchParams.get('is_active')
        let query = db
          .from('playbooks')
          .select(SELECT)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit)
        if (activeParam === 'true' || activeParam === 'false') {
          query = query.eq('is_active', activeParam === 'true')
        }
        const { data, error } = await query
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data: data ?? [] }, 200, requestId)
      })()
    }
    if (req.method === 'POST') {
      if (!canMutate(role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Only members can manage playbooks')
      }
      return (async () => {
        const payload = validatePlaybookBody(await jsonBody(req), false)
        const { data, error } = await db
          .from('playbooks')
          .insert(
            {
              ...payload,
              org_id: orgId,
            } as Database['public']['Tables']['playbooks']['Insert'],
          )
          .select(SELECT)
          .single()
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data }, 201, requestId, {
          etag: etag(data.version),
          location: `/api/v1/playbooks/${data.id}`,
        })
      })()
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for playbooks')
  }

  const runsMatch = path.match(
    /^\/api\/v1\/playbooks\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/runs$/i,
  )
  if (runsMatch) {
    const playbookId = parseUuid(runsMatch[1], 'id')
    if (req.method === 'GET') {
      return (async () => {
        await findPlaybook(db, orgId, playbookId, requestId)
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        const { data, error } = await db
          .from('playbook_runs')
          .select(
            'id,org_id,playbook_id,created_at,updated_at,status,trigger_kind,trigger_payload,root_entity_type,root_entity_id,current_node_id,next_action_at,playbook_version,last_error',
          )
          .eq('org_id', orgId)
          .eq('playbook_id', playbookId)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data: data ?? [] }, 200, requestId)
      })()
    }
    if (req.method === 'POST') {
      if (!canMutate(role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Only members can run playbooks')
      }
      return (async () => {
        await findPlaybook(db, orgId, playbookId, requestId)
        let body: Record<string, unknown> = {}
        try {
          body = await jsonBody(req)
        } catch {
          body = {}
        }
        const rootType = typeof body.root_entity_type === 'string' ? body.root_entity_type : null
        const rootIdRaw = body.root_entity_id
        const rootId = typeof rootIdRaw === 'string' && rootIdRaw
          ? parseUuid(rootIdRaw, 'root_entity_id')
          : null
        const { data, error } = await db.rpc('start_playbook_run_manual', {
          p_org_id: orgId,
          p_playbook_id: playbookId,
          p_root_entity_type: rootType,
          p_root_entity_id: rootId,
          p_trigger_payload: (body.trigger_payload as Json) ?? {},
        })
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data }, 201, requestId)
      })()
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for playbook runs')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/playbooks\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const playbookId = parseUuid(itemMatch[1], 'id')

  if (req.method === 'GET') {
    return findPlaybook(db, orgId, playbookId, requestId).then((data) =>
      jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    )
  }

  if (req.method === 'PATCH') {
    if (!canMutate(role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Only members can manage playbooks')
    }
    return (async () => {
      const version = parseVersion(req)
      const current = await findPlaybook(db, orgId, playbookId, requestId)
      if (current.version !== version) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Playbook version does not match If-Match',
        )
      }
      const payload = validatePlaybookBody(await jsonBody(req), true)
      const { data, error } = await db
        .from('playbooks')
        .update(payload as Partial<Database['public']['Tables']['playbooks']['Insert']>)
        .eq('org_id', orgId)
        .eq('id', playbookId)
        .eq('version', version)
        .is('deleted_at', null)
        .select(SELECT)
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Playbook version does not match If-Match',
        )
      }
      return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    })()
  }

  if (req.method === 'DELETE') {
    if (!canMutate(role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Only members can manage playbooks')
    }
    return (async () => {
      const version = parseVersion(req)
      const { error } = await db.rpc('soft_delete_playbook', {
        p_playbook_id: playbookId,
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

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for playbook')
}
