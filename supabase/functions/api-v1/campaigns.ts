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
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,status,template_id,mailbox_id,scheduled_at,started_at,completed_at,last_error'

const STATUSES = new Set([
  'draft',
  'scheduled',
  'sending',
  'completed',
  'cancelled',
  'failed',
])
const ENTITY_TYPES = new Set(['lead', 'contact', 'client'])

type CampaignCreate = {
  name: string
  template_id?: string | null
  mailbox_id?: string | null
  scheduled_at?: string | null
  tag_ids?: string[]
  entity_types?: string[]
}

type CampaignUpdate = {
  name?: string
  template_id?: string | null
  mailbox_id?: string | null
  scheduled_at?: string | null
  tag_ids?: string[]
  entity_types?: string[]
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (message.includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Campaign version does not match If-Match')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'A campaign with this name already exists')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      error.message || 'Campaign failed a database constraint',
    )
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Campaign not found')
  }
  console.error('Campaign operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The campaign operation failed')
}

function parseUuidArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} must be an array`, {
      [field]: 'Must be an array of uuids',
    })
  }
  return value.map((id, index) => {
    if (typeof id !== 'string') {
      throw new ApiError(422, 'VALIDATION_ERROR', `${field} must be uuid strings`, {
        [`${field}[${index}]`]: 'Must be a uuid',
      })
    }
    return parseUuid(id, `${field}[${index}]`)
  })
}

function parseEntityTypes(value: unknown): string[] {
  if (value === undefined) return ['lead', 'contact', 'client']
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'entity_types must be a non-empty array', {
      entity_types: 'Must include lead, contact, and/or client',
    })
  }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !ENTITY_TYPES.has(item)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'entity_types is invalid', {
        entity_types: 'Must be lead, contact, and/or client',
      })
    }
    if (!out.includes(item)) out.push(item)
  }
  return out
}

export function validateCampaignBody(
  body: Record<string, unknown>,
  partial: boolean,
): CampaignCreate | CampaignUpdate {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'name',
    'template_id',
    'mailbox_id',
    'scheduled_at',
    'tag_ids',
    'entity_types',
  ])
  const output: Record<string, unknown> = {}

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Unknown field'
  }
  if ('org_id' in body) fields.org_id = 'Must not be supplied in the request body'
  if ('status' in body) fields.status = 'Status is managed by launch/cancel endpoints'

  if (partial) {
    const hasWritableField = Object.keys(body).some((key) => writable.has(key))
    if (!hasWritableField) fields._ = 'At least one field is required'
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

  if ('template_id' in body) {
    if (body.template_id === null || body.template_id === '') {
      output.template_id = null
    } else if (typeof body.template_id === 'string') {
      try {
        output.template_id = parseUuid(body.template_id, 'template_id')
      } catch {
        fields.template_id = 'Must be a uuid or null'
      }
    } else {
      fields.template_id = 'Must be a uuid or null'
    }
  }

  if ('mailbox_id' in body) {
    if (body.mailbox_id === null || body.mailbox_id === '') {
      output.mailbox_id = null
    } else if (typeof body.mailbox_id === 'string') {
      try {
        output.mailbox_id = parseUuid(body.mailbox_id, 'mailbox_id')
      } catch {
        fields.mailbox_id = 'Must be a uuid or null'
      }
    } else {
      fields.mailbox_id = 'Must be a uuid or null'
    }
  }

  if ('scheduled_at' in body) {
    if (body.scheduled_at === null || body.scheduled_at === '') {
      output.scheduled_at = null
    } else if (typeof body.scheduled_at === 'string') {
      const ts = Date.parse(body.scheduled_at)
      if (Number.isNaN(ts)) {
        fields.scheduled_at = 'Must be an ISO datetime or null'
      } else {
        output.scheduled_at = new Date(ts).toISOString()
      }
    } else {
      fields.scheduled_at = 'Must be an ISO datetime or null'
    }
  }

  if ('tag_ids' in body) {
    try {
      output.tag_ids = parseUuidArray(body.tag_ids, 'tag_ids')
    } catch (err) {
      if (err instanceof ApiError) throw err
      fields.tag_ids = 'Must be an array of uuids'
    }
  }

  if ('entity_types' in body) {
    try {
      output.entity_types = parseEntityTypes(body.entity_types)
    } catch (err) {
      if (err instanceof ApiError) throw err
      fields.entity_types = 'Must be lead, contact, and/or client'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Campaign validation failed', fields)
  }
  return output as CampaignCreate | CampaignUpdate
}

async function findCampaign(
  db: DatabaseClient,
  orgId: string,
  campaignId: string,
  requestId: string,
) {
  const { data, error } = await db
    .from('campaigns')
    .select(SELECT)
    .eq('org_id', orgId)
    .eq('id', campaignId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found')
  return data
}

async function loadAudience(
  db: DatabaseClient,
  orgId: string,
  campaignId: string,
): Promise<{ tag_ids: string[]; entity_types: string[] }> {
  const [{ data: tags }, { data: types }] = await Promise.all([
    db
      .from('campaign_audience_tags')
      .select('tag_id')
      .eq('org_id', orgId)
      .eq('campaign_id', campaignId),
    db
      .from('campaign_audience_entity_types')
      .select('entity_type')
      .eq('org_id', orgId)
      .eq('campaign_id', campaignId),
  ])
  return {
    tag_ids: (tags ?? []).map((row) => row.tag_id),
    entity_types: (types ?? []).map((row) => row.entity_type),
  }
}

async function loadRecipientCounts(
  db: DatabaseClient,
  orgId: string,
  campaignId: string,
): Promise<Record<string, number>> {
  const { data } = await db
    .from('campaign_recipients')
    .select('status')
    .eq('org_id', orgId)
    .eq('campaign_id', campaignId)
  const counts = { pending: 0, sent: 0, skipped: 0, failed: 0, total: 0 }
  for (const row of data ?? []) {
    const status = row.status as keyof typeof counts
    if (status in counts && status !== 'total') counts[status] += 1
    counts.total += 1
  }
  return counts
}

async function enrichCampaign(
  db: DatabaseClient,
  orgId: string,
  campaign: Record<string, unknown>,
) {
  const audience = await loadAudience(db, orgId, String(campaign.id))
  const recipient_counts = await loadRecipientCounts(db, orgId, String(campaign.id))
  let quota_remaining: number | null = null
  if (campaign.mailbox_id) {
    const { data } = await db.rpc('campaign_mailbox_quota_remaining', {
      p_org_id: orgId,
      p_mailbox_id: String(campaign.mailbox_id),
    })
    quota_remaining = typeof data === 'number' ? data : null
  }
  return {
    ...campaign,
    tag_ids: audience.tag_ids,
    entity_types: audience.entity_types.length
      ? audience.entity_types
      : ['lead', 'contact', 'client'],
    recipient_counts,
    quota_remaining,
  }
}

async function replaceAudience(
  db: DatabaseClient,
  orgId: string,
  campaignId: string,
  tagIds: string[] | undefined,
  entityTypes: string[] | undefined,
  requestId: string,
) {
  if (tagIds === undefined && entityTypes === undefined) return
  const current = await loadAudience(db, orgId, campaignId)
  const { error } = await db.rpc('replace_campaign_audience', {
    p_campaign_id: campaignId,
    p_org_id: orgId,
    p_tag_ids: tagIds ?? current.tag_ids,
    p_entity_types: entityTypes ??
      (current.entity_types.length ? current.entity_types : ['lead', 'contact', 'client']),
  })
  if (error) throw databaseError(error, requestId)
}

export function handleCampaigns(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRow['role'],
  requestId: string,
): Promise<Response> {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access campaigns')
  }
  const canMutate = role === 'owner' || role === 'admin' || role === 'member'

  if (path === '/api/v1/campaigns') {
    if (req.method === 'GET') {
      return (async () => {
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        const status = url.searchParams.get('status')
        if (status && !STATUSES.has(status)) {
          throw new ApiError(400, 'BAD_REQUEST', 'status is invalid', {
            status: 'Must be a known campaign status',
          })
        }
        let query = db
          .from('campaigns')
          .select(SELECT)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit)
        if (status) {
          query = query.eq(
            'status',
            status as Database['public']['Tables']['campaigns']['Row']['status'],
          )
        }
        const { data, error } = await query
        if (error) throw databaseError(error, requestId)
        const enriched = await Promise.all(
          (data ?? []).map((row) => enrichCampaign(db, orgId, row)),
        )
        return jsonResponse({ data: enriched }, 200, requestId)
      })()
    }

    if (req.method === 'POST') {
      if (!canMutate) {
        throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage campaigns')
      }
      return (async () => {
        const payload = validateCampaignBody(await jsonBody(req), false) as CampaignCreate
        const { tag_ids, entity_types, ...row } = payload
        const { data, error } = await db
          .from('campaigns')
          .insert({
            org_id: orgId,
            name: row.name,
            template_id: row.template_id ?? null,
            mailbox_id: row.mailbox_id ?? null,
            scheduled_at: row.scheduled_at ?? null,
            status: 'draft',
          })
          .select(SELECT)
          .single()
        if (error) throw databaseError(error, requestId)

        if (tag_ids || entity_types) {
          await replaceAudience(
            db,
            orgId,
            data.id,
            tag_ids ?? [],
            entity_types ?? ['lead', 'contact', 'client'],
            requestId,
          )
        }

        // replace_campaign_audience stamps campaigns.version — always return the fresh row.
        const created = await findCampaign(db, orgId, data.id, requestId)
        const enriched = await enrichCampaign(db, orgId, created)
        return jsonResponse({ data: enriched }, 201, requestId, {
          etag: etag(created.version),
          location: `/api/v1/campaigns/${created.id}`,
        })
      })()
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for campaigns')
  }

  const previewMatch = path.match(
    /^\/api\/v1\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/audience-preview$/i,
  )
  if (previewMatch) {
    if (req.method !== 'POST' && req.method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for audience preview')
    }
    const campaignId = parseUuid(previewMatch[1], 'id')
    return (async () => {
      await findCampaign(db, orgId, campaignId, requestId)
      let tagIds: string[]
      let entityTypes: string[]
      if (req.method === 'POST') {
        const body = await jsonBody(req)
        tagIds = 'tag_ids' in body
          ? parseUuidArray(body.tag_ids, 'tag_ids')
          : (await loadAudience(db, orgId, campaignId)).tag_ids
        entityTypes = 'entity_types' in body
          ? parseEntityTypes(body.entity_types)
          : (await loadAudience(db, orgId, campaignId)).entity_types
      } else {
        const audience = await loadAudience(db, orgId, campaignId)
        tagIds = audience.tag_ids
        entityTypes = audience.entity_types.length
          ? audience.entity_types
          : ['lead', 'contact', 'client']
      }
      const { data, error } = await db.rpc('resolve_campaign_audience', {
        p_org_id: orgId,
        p_tag_ids: tagIds,
        p_entity_types: entityTypes.length ? entityTypes : ['lead', 'contact', 'client'],
        p_limit: 500,
      })
      if (error) throw databaseError(error, requestId)
      const rows = (data ?? []) as Array<{
        entity_type: string
        entity_id: string
        to_email: string | null
        to_name: string | null
        skip_reason: string | null
      }>
      const sendable = rows.filter((r) => !r.skip_reason)
      const skipped = rows.filter((r) => r.skip_reason)
      return jsonResponse(
        {
          data: {
            total: rows.length,
            sendable: sendable.length,
            skipped: skipped.length,
            capped: rows.length >= 500,
            sample: sendable.slice(0, 25),
            skipped_sample: skipped.slice(0, 10),
          },
        },
        200,
        requestId,
      )
    })()
  }

  const launchMatch = path.match(
    /^\/api\/v1\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/launch$/i,
  )
  if (launchMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for campaign launch')
    }
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot launch campaigns')
    }
    const campaignId = parseUuid(launchMatch[1], 'id')
    return (async () => {
      const version = parseVersion(req)
      const body = await jsonBody(req).catch(() => ({} as Record<string, unknown>))
      const sendImmediately = body.send_immediately !== false
      const { data, error } = await db.rpc('launch_campaign', {
        p_campaign_id: campaignId,
        p_org_id: orgId,
        p_expected_version: version,
        p_send_immediately: sendImmediately,
      })
      if (error) throw databaseError(error, requestId)
      const enriched = await enrichCampaign(db, orgId, data as Record<string, unknown>)
      return jsonResponse({ data: enriched }, 200, requestId, {
        etag: etag((data as { version: number }).version),
      })
    })()
  }

  const cancelMatch = path.match(
    /^\/api\/v1\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/cancel$/i,
  )
  if (cancelMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for campaign cancel')
    }
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot cancel campaigns')
    }
    const campaignId = parseUuid(cancelMatch[1], 'id')
    return (async () => {
      const version = parseVersion(req)
      const { data, error } = await db.rpc('cancel_campaign', {
        p_campaign_id: campaignId,
        p_org_id: orgId,
        p_expected_version: version,
      })
      if (error) throw databaseError(error, requestId)
      const enriched = await enrichCampaign(db, orgId, data as Record<string, unknown>)
      return jsonResponse({ data: enriched }, 200, requestId, {
        etag: etag((data as { version: number }).version),
      })
    })()
  }

  const recipientsMatch = path.match(
    /^\/api\/v1\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/recipients$/i,
  )
  if (recipientsMatch) {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for campaign recipients')
    }
    const campaignId = parseUuid(recipientsMatch[1], 'id')
    return (async () => {
      await findCampaign(db, orgId, campaignId, requestId)
      const url = new URL(req.url)
      // Matches launch snapshot cap (resolve_campaign_audience max 500).
      const limit = parseLimit(url.searchParams.get('limit'), { max: 500 })
      const status = url.searchParams.get('status')
      let query = db
        .from('campaign_recipients')
        .select(
          'id,org_id,campaign_id,created_at,updated_at,entity_type,entity_id,to_email,to_name,status,error,sent_at,email_message_id',
        )
        .eq('org_id', orgId)
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      if (status) {
        query = query.eq(
          'status',
          status as Database['public']['Tables']['campaign_recipients']['Row']['status'],
        )
      }
      const { data, error } = await query
      if (error) throw databaseError(error, requestId)
      return jsonResponse({ data: data ?? [] }, 200, requestId)
    })()
  }

  const itemMatch = path.match(
    /^\/api\/v1\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const campaignId = parseUuid(itemMatch[1], 'id')

  if (req.method === 'GET') {
    return (async () => {
      const data = await findCampaign(db, orgId, campaignId, requestId)
      const enriched = await enrichCampaign(db, orgId, data)
      return jsonResponse({ data: enriched }, 200, requestId, { etag: etag(data.version) })
    })()
  }

  if (req.method === 'PATCH') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage campaigns')
    }
    return (async () => {
      const version = parseVersion(req)
      const current = await findCampaign(db, orgId, campaignId, requestId)
      if (current.version !== version) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Campaign version does not match If-Match',
        )
      }
      if (current.status !== 'draft') {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Only draft campaigns can be edited', {
          status: 'Campaign is not a draft',
        })
      }
      const payload = validateCampaignBody(await jsonBody(req), true) as CampaignUpdate
      const { tag_ids, entity_types, ...row } = payload
      if (Object.keys(row).length > 0) {
        const { data, error } = await db
          .from('campaigns')
          .update(row)
          .eq('org_id', orgId)
          .eq('id', campaignId)
          .eq('version', version)
          .is('deleted_at', null)
          .select(SELECT)
          .maybeSingle()
        if (error) throw databaseError(error, requestId)
        if (!data) {
          throw new ApiError(
            412,
            'PRECONDITION_FAILED',
            'Campaign version does not match If-Match',
          )
        }
      }
      await replaceAudience(db, orgId, campaignId, tag_ids, entity_types, requestId)
      // Audience RPC also stamps campaigns.version — re-read so clients keep a matching etag.
      const refreshed = await findCampaign(db, orgId, campaignId, requestId)
      const enriched = await enrichCampaign(db, orgId, refreshed)
      return jsonResponse({ data: enriched }, 200, requestId, {
        etag: etag(refreshed.version),
      })
    })()
  }

  if (req.method === 'DELETE') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage campaigns')
    }
    return (async () => {
      const version = parseVersion(req)
      const { error } = await db.rpc('soft_delete_campaign', {
        p_campaign_id: campaignId,
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

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for campaign')
}
