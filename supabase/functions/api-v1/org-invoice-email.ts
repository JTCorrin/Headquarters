import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { payloadHasForbiddenSecretKey } from './integrations.ts'
import {
  generateOutboundMessageId,
  sendSmtpMail,
  type SmtpSecurity,
  SmtpSendError,
} from '../_shared/smtp-outbound.ts'
import { readOrgInvoiceEmailCredentials } from '../_shared/org-invoice-email-credentials.ts'
import { ApiError, jsonBody, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

const SECURITY = new Set(['tls', 'starttls', 'none'])

export type OrgInvoiceEmailUpsertBody = {
  from_address: string
  from_name: string | null
  reply_to: string | null
  smtp_host: string
  smtp_port: number
  smtp_security: string
  username: string
  password: string | null
  subject_template: string | null
  body_template: string | null
}

function serviceRoleClient(): DatabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Service credentials are unavailable')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function assertCanReadInvoiceEmail(role: MembershipRole): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access invoice email')
  }
}

function assertCanWriteInvoiceEmail(role: MembershipRole): void {
  if (role !== 'owner') {
    throw new ApiError(403, 'FORBIDDEN', 'Only owners can manage invoice email')
  }
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Invoice email operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not configured')) {
    return new ApiError(404, 'NOT_FOUND', 'Invoice email is not configured')
  }
  if (error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'Invoice email validation failed')
  }
  console.error('Invoice email operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The invoice email operation failed')
}

function assertNoSecretEcho(payload: unknown): void {
  if (payloadHasForbiddenSecretKey(payload)) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Invoice email response contained a forbidden secret field',
    )
  }
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function isHostname(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(value)
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320
}

function testFailure(errorCode: string, message: string): {
  ok: false
  error_code: string
  message: string
} {
  return { ok: false, error_code: errorCode, message }
}

export function validateOrgInvoiceEmailBody(
  body: Record<string, unknown>,
): OrgInvoiceEmailUpsertBody {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'from_address',
    'from_name',
    'reply_to',
    'smtp_host',
    'smtp_port',
    'smtp_security',
    'username',
    'password',
    'subject_template',
    'body_template',
  ])
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  const fromAddress = typeof body.from_address === 'string' ? body.from_address.trim() : ''
  if (!isEmail(fromAddress)) fields.from_address = 'Must be a valid email address'

  let fromName: string | null = null
  if ('from_name' in body) {
    if (body.from_name === null) {
      fromName = null
    } else if (typeof body.from_name === 'string') {
      fromName = body.from_name.trim() || null
      if (fromName && fromName.length > 120) fields.from_name = 'Must be at most 120 characters'
    } else {
      fields.from_name = 'Must be a string or null'
    }
  }

  let replyTo: string | null = null
  if ('reply_to' in body) {
    if (body.reply_to === null) {
      replyTo = null
    } else if (typeof body.reply_to === 'string') {
      const trimmed = body.reply_to.trim()
      if (trimmed.length > 0) {
        if (!isEmail(trimmed)) fields.reply_to = 'Must be a valid email address or null'
        else replyTo = trimmed.toLowerCase()
      }
    } else {
      fields.reply_to = 'Must be a string or null'
    }
  }

  const smtpHost = typeof body.smtp_host === 'string' ? body.smtp_host.trim() : ''
  if (!smtpHost || !isHostname(smtpHost)) fields.smtp_host = 'Must be a valid hostname'

  const smtpPort = typeof body.smtp_port === 'number' && Number.isInteger(body.smtp_port)
    ? body.smtp_port
    : NaN
  if (!(smtpPort >= 1 && smtpPort <= 65535)) fields.smtp_port = 'Must be an integer 1–65535'

  const smtpSecurity = typeof body.smtp_security === 'string' ? body.smtp_security : ''
  if (!SECURITY.has(smtpSecurity)) fields.smtp_security = 'Must be tls, starttls, or none'

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  if (!username || username.length > 320) {
    fields.username = 'Must be 1–320 characters'
  } else if (hasControlChars(username)) {
    fields.username = 'Must not contain control characters'
  }

  let password: string | null = null
  if ('password' in body) {
    if (body.password === null || body.password === undefined) {
      password = null
    } else if (typeof body.password === 'string') {
      if (body.password.length === 0) {
        fields.password = 'Password cannot be empty; omit to keep existing'
      } else if (body.password.length > 512) {
        fields.password = 'Must be at most 512 characters'
      } else if (hasControlChars(body.password)) {
        fields.password = 'Must not contain control characters'
      } else {
        password = body.password
      }
    } else {
      fields.password = 'Must be a string'
    }
  }

  let subjectTemplate: string | null = null
  if ('subject_template' in body) {
    if (body.subject_template === null) {
      subjectTemplate = null
    } else if (typeof body.subject_template === 'string') {
      const trimmed = body.subject_template.trim()
      if (trimmed.length < 1 || trimmed.length > 500) {
        fields.subject_template = 'Must be between 1 and 500 characters'
      } else {
        subjectTemplate = trimmed
      }
    } else {
      fields.subject_template = 'Must be a string or null'
    }
  }

  let bodyTemplate: string | null = null
  if ('body_template' in body) {
    if (body.body_template === null) {
      bodyTemplate = null
    } else if (typeof body.body_template === 'string') {
      if (body.body_template.length < 1 || body.body_template.length > 10000) {
        fields.body_template = 'Must be between 1 and 10000 characters'
      } else {
        bodyTemplate = body.body_template
      }
    } else {
      fields.body_template = 'Must be a string or null'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invoice email validation failed', fields)
  }

  return {
    from_address: fromAddress.toLowerCase(),
    from_name: fromName,
    reply_to: replyTo,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_security: smtpSecurity,
    username,
    password,
    subject_template: subjectTemplate,
    body_template: bodyTemplate,
  }
}

async function getInvoiceEmail(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('get_org_invoice_email_account', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  if (data === null || data === undefined) {
    throw new ApiError(404, 'NOT_FOUND', 'Invoice email is not configured')
  }
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

async function putInvoiceEmail(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateOrgInvoiceEmailBody(await jsonBody(req))
  const { data, error } = await db.rpc('upsert_org_invoice_email_account', {
    p_org_id: orgId,
    p_from_address: payload.from_address,
    p_from_name: payload.from_name,
    p_reply_to: payload.reply_to,
    p_smtp_host: payload.smtp_host,
    p_smtp_port: payload.smtp_port,
    p_smtp_security: payload.smtp_security,
    p_username: payload.username,
    p_password: payload.password,
    p_subject_template: payload.subject_template,
    p_body_template: payload.body_template,
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

async function deleteInvoiceEmail(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { error } = await db.rpc('disconnect_org_invoice_email_account', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function testInvoiceEmail(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const service = serviceRoleClient()
  const creds = await readOrgInvoiceEmailCredentials(service, orgId)
  if (!creds) {
    return jsonResponse(
      {
        data: testFailure(
          'credentials_missing',
          'Invoice email is not configured — save SMTP settings, then try Test again.',
        ),
      },
      200,
      requestId,
    )
  }
  if (!creds.password) {
    return jsonResponse(
      {
        data: testFailure(
          'credentials_missing',
          'Invoice email password is missing — save SMTP credentials, then try Test again.',
        ),
      },
      200,
      requestId,
    )
  }

  const from = creds.from_name
    ? `"${creds.from_name.replace(/"/g, '\\"')}" <${creds.from_address}>`
    : creds.from_address
  const security = creds.smtp_security as SmtpSecurity
  const messageId = generateOutboundMessageId(creds.from_address)

  let ok = false
  let errorCode: string | null = null
  let message = 'SMTP test message sent successfully.'

  try {
    await sendSmtpMail({
      host: creds.smtp_host,
      port: creds.smtp_port,
      security,
      auth: { type: 'password', username: creds.username, password: creds.password },
      from,
      to: creds.from_address,
      subject: 'Invoice email test',
      bodyText: 'This is a test message from your organisation invoice email settings.',
      messageId,
    })
    ok = true
  } catch (error) {
    if (error instanceof SmtpSendError) {
      errorCode = error.code
      message = error.message
    } else {
      errorCode = 'smtp_send_failed'
      message = error instanceof Error ? error.message : 'SMTP test failed'
    }
  }

  const { error: markError } = await db.rpc('mark_org_invoice_email_test_result', {
    p_org_id: orgId,
    p_ok: ok,
    p_error_code: errorCode,
    p_error_message: ok ? null : message,
  })
  if (markError) throw databaseError(markError, requestId)

  return jsonResponse(
    {
      data: ok
        ? { ok: true, error_code: null, message }
        : testFailure(errorCode ?? 'test_failed', message),
    },
    200,
    requestId,
  )
}

export function handleOrgInvoiceEmail(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/organisation/invoice-email') {
    assertCanReadInvoiceEmail(role)
    if (req.method === 'GET') return getInvoiceEmail(db, orgId, requestId)
    if (req.method === 'PUT') {
      assertCanWriteInvoiceEmail(role)
      return putInvoiceEmail(req, db, orgId, requestId)
    }
    if (req.method === 'DELETE') {
      assertCanWriteInvoiceEmail(role)
      return deleteInvoiceEmail(db, orgId, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for invoice email')
  }

  if (path === '/api/v1/organisation/invoice-email/test') {
    assertCanWriteInvoiceEmail(role)
    if (req.method === 'POST') return testInvoiceEmail(db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for invoice email test')
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
