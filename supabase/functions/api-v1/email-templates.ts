import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  EmailTemplateInsert,
  EmailTemplateRow,
  MembershipRow,
} from '../_shared/database.ts'
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
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,subject,body_text,body_html,category,status,merge_schema'

const CATEGORIES = new Set(['transactional', 'campaign', 'chase', 'onboarding', 'other'])
const STATUSES = new Set(['draft', 'active', 'archived'])

type TemplateCreate = {
  name: string
  subject: string
  body_text?: string | null
  body_html?: string | null
  category: EmailTemplateRow['category']
  status: EmailTemplateRow['status']
  merge_schema: EmailTemplateRow['merge_schema']
}

type TemplateUpdate = Partial<TemplateCreate>

export function validateEmailTemplateBody(
  body: Record<string, unknown>,
  partial: false,
): TemplateCreate
export function validateEmailTemplateBody(
  body: Record<string, unknown>,
  partial: true,
): TemplateUpdate
export function validateEmailTemplateBody(
  body: Record<string, unknown>,
  partial: boolean,
): TemplateCreate | TemplateUpdate {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'name',
    'subject',
    'body_text',
    'body_html',
    'category',
    'status',
    'merge_schema',
  ])
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

  if ('subject' in body) {
    const value = body.subject
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
      fields.subject = 'Must be a non-empty string up to 200 characters'
    } else {
      output.subject = value.trim()
    }
  } else if (!partial) {
    fields.subject = 'Required'
  }

  if ('body_text' in body) {
    if (body.body_text === null) {
      output.body_text = null
    } else if (typeof body.body_text !== 'string' || body.body_text.length > 200_000) {
      fields.body_text = 'Must be a string up to 200000 characters or null'
    } else {
      output.body_text = body.body_text
    }
  }

  if ('body_html' in body) {
    if (body.body_html === null) {
      output.body_html = null
    } else if (typeof body.body_html !== 'string' || body.body_html.length > 200_000) {
      fields.body_html = 'Must be a string up to 200000 characters or null'
    } else {
      output.body_html = body.body_html
    }
  }

  if ('category' in body) {
    if (typeof body.category !== 'string' || !CATEGORIES.has(body.category)) {
      fields.category = 'Must be transactional, campaign, chase, onboarding, or other'
    } else {
      output.category = body.category as EmailTemplateRow['category']
    }
  } else if (!partial) {
    fields.category = 'Required'
  }

  if ('status' in body) {
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
      fields.status = 'Must be draft, active, or archived'
    } else {
      output.status = body.status as EmailTemplateRow['status']
    }
  } else if (!partial) {
    output.status = 'draft'
  }

  if ('merge_schema' in body) {
    if (!Array.isArray(body.merge_schema)) {
      fields.merge_schema = 'Must be a JSON array'
    } else {
      output.merge_schema = body.merge_schema as EmailTemplateRow['merge_schema']
    }
  } else if (!partial) {
    output.merge_schema = []
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Email template validation failed', fields)
  }

  return output as TemplateCreate | TemplateUpdate
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  if (error.message?.toLowerCase().includes('version conflict')) {
    return new ApiError(
      412,
      'PRECONDITION_FAILED',
      'Email template version does not match If-Match',
    )
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'An email template with this name already exists')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      error.message || 'Email template failed a database constraint',
    )
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002' || error.message?.toLowerCase().includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Email template not found')
  }
  console.error('Email template operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The email template operation failed')
}

async function findTemplate(
  db: DatabaseClient,
  orgId: string,
  templateId: string,
  requestId: string,
): Promise<EmailTemplateRow> {
  const { data, error } = await db
    .from('email_templates')
    .select(SELECT)
    .eq('org_id', orgId)
    .eq('id', templateId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Email template not found')
  return data as EmailTemplateRow
}

export function handleEmailTemplates(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRow['role'],
  requestId: string,
): Promise<Response> {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access email templates')
  }
  const canMutate = role === 'owner' || role === 'admin' || role === 'member'

  if (path === '/api/v1/email-templates') {
    if (req.method === 'GET') {
      return (async () => {
        const url = new URL(req.url)
        const limit = parseLimit(url.searchParams.get('limit'))
        const status = url.searchParams.get('status')
        const category = url.searchParams.get('category')
        if (status && !STATUSES.has(status)) {
          throw new ApiError(400, 'BAD_REQUEST', 'status is invalid', {
            status: 'Must be draft, active, or archived',
          })
        }
        if (category && !CATEGORIES.has(category)) {
          throw new ApiError(400, 'BAD_REQUEST', 'category is invalid', {
            category: 'Must be a known template category',
          })
        }
        let query = db
          .from('email_templates')
          .select(SELECT)
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit)
        if (status) query = query.eq('status', status as EmailTemplateRow['status'])
        if (category) query = query.eq('category', category as EmailTemplateRow['category'])
        const { data, error } = await query
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data: data ?? [] }, 200, requestId)
      })()
    }
    if (req.method === 'POST') {
      if (!canMutate) {
        throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage email templates')
      }
      return (async () => {
        const payload = validateEmailTemplateBody(await jsonBody(req), false)
        const { data, error } = await db
          .from('email_templates')
          .insert(
            {
              ...payload,
              org_id: orgId,
            } as Database['public']['Tables']['email_templates']['Insert'],
          )
          .select(SELECT)
          .single()
        if (error) throw databaseError(error, requestId)
        return jsonResponse({ data }, 201, requestId, {
          etag: etag(data.version),
          location: `/api/v1/email-templates/${data.id}`,
        })
      })()
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for email templates')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/email-templates\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  const templateId = parseUuid(itemMatch[1], 'id')

  if (req.method === 'GET') {
    return findTemplate(db, orgId, templateId, requestId).then((data) =>
      jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    )
  }

  if (req.method === 'PATCH') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage email templates')
    }
    return (async () => {
      const version = parseVersion(req)
      const current = await findTemplate(db, orgId, templateId, requestId)
      if (current.version !== version) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Email template version does not match If-Match',
        )
      }
      const payload = validateEmailTemplateBody(await jsonBody(req), true)
      const { data, error } = await db
        .from('email_templates')
        .update(payload as Partial<EmailTemplateInsert>)
        .eq('org_id', orgId)
        .eq('id', templateId)
        .eq('version', version)
        .is('deleted_at', null)
        .select(SELECT)
        .maybeSingle()
      if (error) throw databaseError(error, requestId)
      if (!data) {
        throw new ApiError(
          412,
          'PRECONDITION_FAILED',
          'Email template version does not match If-Match',
        )
      }
      return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
    })()
  }

  if (req.method === 'DELETE') {
    if (!canMutate) {
      throw new ApiError(403, 'FORBIDDEN', 'This membership cannot manage email templates')
    }
    return (async () => {
      const version = parseVersion(req)
      // Direct UPDATE ... deleted_at fails under RLS on staging (500);
      // mutate through the security-definer RPC (same pattern as products).
      const { error } = await db.rpc('soft_delete_email_template', {
        p_template_id: templateId,
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

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for email template')
}
