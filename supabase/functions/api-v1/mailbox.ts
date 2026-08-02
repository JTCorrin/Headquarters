import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import { ApiError, jsonBody, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

const SECURITY = new Set(['tls', 'starttls', 'none'])

export type MailboxUpsertBody = {
  email_address: string
  from_name: string | null
  imap_host: string
  imap_port: number
  imap_security: string
  smtp_host: string
  smtp_port: number
  smtp_security: string
  username: string
  password: string | null
}

function assertCanAccessMailbox(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access mailboxes')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify mailboxes')
  }
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Mailbox operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Mailbox not found')
  }
  if (error.code === '22023' || message.includes('password is required')) {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'Mailbox validation failed')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'A mailbox already exists for this membership')
  }
  console.error('Mailbox operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The mailbox operation failed')
}

function isHostname(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(value)
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320
}

export function validateMailboxBody(body: Record<string, unknown>): MailboxUpsertBody {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'email_address',
    'from_name',
    'imap_host',
    'imap_port',
    'imap_security',
    'smtp_host',
    'smtp_port',
    'smtp_security',
    'username',
    'password',
  ])
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  const email = typeof body.email_address === 'string' ? body.email_address.trim() : ''
  if (!isEmail(email)) fields.email_address = 'Must be a valid email address'

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

  const imapHost = typeof body.imap_host === 'string' ? body.imap_host.trim() : ''
  if (!imapHost || !isHostname(imapHost)) fields.imap_host = 'Must be a valid hostname'

  const smtpHost = typeof body.smtp_host === 'string' ? body.smtp_host.trim() : ''
  if (!smtpHost || !isHostname(smtpHost)) fields.smtp_host = 'Must be a valid hostname'

  const imapPort = typeof body.imap_port === 'number' && Number.isInteger(body.imap_port)
    ? body.imap_port
    : NaN
  if (!(imapPort >= 1 && imapPort <= 65535)) fields.imap_port = 'Must be an integer 1–65535'

  const smtpPort = typeof body.smtp_port === 'number' && Number.isInteger(body.smtp_port)
    ? body.smtp_port
    : NaN
  if (!(smtpPort >= 1 && smtpPort <= 65535)) fields.smtp_port = 'Must be an integer 1–65535'

  const imapSecurity = typeof body.imap_security === 'string' ? body.imap_security : ''
  if (!SECURITY.has(imapSecurity)) fields.imap_security = 'Must be tls, starttls, or none'

  const smtpSecurity = typeof body.smtp_security === 'string' ? body.smtp_security : ''
  if (!SECURITY.has(smtpSecurity)) fields.smtp_security = 'Must be tls, starttls, or none'

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  if (!username || username.length > 320) fields.username = 'Must be 1–320 characters'

  let password: string | null = null
  if ('password' in body) {
    if (body.password === null || body.password === undefined) {
      password = null
    } else if (typeof body.password === 'string') {
      if (body.password.length === 0) {
        fields.password = 'Password cannot be empty; omit to keep existing'
      } else if (body.password.length > 512) {
        fields.password = 'Must be at most 512 characters'
      } else {
        password = body.password
      }
    } else {
      fields.password = 'Must be a string'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Mailbox validation failed', fields)
  }

  return {
    email_address: email.toLowerCase(),
    from_name: fromName,
    imap_host: imapHost,
    imap_port: imapPort,
    imap_security: imapSecurity,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_security: smtpSecurity,
    username,
    password,
  }
}

export function validateMailboxTestBody(
  body: Record<string, unknown>,
): { password: string | null } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'password') fields[key] = 'Field is not writable'
  }
  let password: string | null = null
  if ('password' in body) {
    if (typeof body.password !== 'string' || body.password.length === 0) {
      fields.password = 'Must be a non-empty string when provided'
    } else if (body.password.length > 512) {
      fields.password = 'Must be at most 512 characters'
    } else {
      password = body.password
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Mailbox test validation failed', fields)
  }
  return { password }
}

function assertNoSecretEcho(payload: unknown): void {
  const text = JSON.stringify(payload)
  if (
    text.includes('"secret_ref"') ||
    text.includes('"password"') ||
    text.includes('"api_key"')
  ) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Mailbox response contained a forbidden secret field')
  }
}

async function getMailbox(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('get_mailbox_account', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  if (data === null || data === undefined) {
    throw new ApiError(404, 'NOT_FOUND', 'Mailbox not found')
  }
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

async function putMailbox(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateMailboxBody(await jsonBody(req))
  const { data, error } = await db.rpc('upsert_mailbox_account', {
    p_org_id: orgId,
    p_email_address: payload.email_address,
    p_from_name: payload.from_name,
    p_imap_host: payload.imap_host,
    p_imap_port: payload.imap_port,
    p_imap_security: payload.imap_security,
    p_smtp_host: payload.smtp_host,
    p_smtp_port: payload.smtp_port,
    p_smtp_security: payload.smtp_security,
    p_username: payload.username,
    p_password: payload.password,
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

async function deleteMailbox(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { error } = await db.rpc('disconnect_mailbox_account', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function testMailbox(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  // Wave A: no live IMAP — validate credentials presence only. Never log body.
  let password: string | null = null
  if (req.headers.get('content-type')?.includes('application/json')) {
    const raw = await req.text()
    if (raw.trim().length > 0) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new ApiError(400, 'BAD_REQUEST', 'Request body must be valid JSON')
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ApiError(400, 'BAD_REQUEST', 'Request body must be a JSON object')
      }
      password = validateMailboxTestBody(parsed as Record<string, unknown>).password
    }
  }

  const { data, error } = await db.rpc('mailbox_credentials_present', {
    p_org_id: orgId,
    p_password: password,
  })
  if (error) throw databaseError(error, requestId)

  if (!data) {
    return jsonResponse(
      { data: { ok: false, error_code: 'credentials_missing' } },
      200,
      requestId,
    )
  }

  // Confirm mailbox row exists when using stored credentials.
  if (!password) {
    const { data: mailbox, error: mailboxError } = await db.rpc('get_mailbox_account', {
      p_org_id: orgId,
    })
    if (mailboxError) throw databaseError(mailboxError, requestId)
    if (!mailbox) {
      return jsonResponse(
        { data: { ok: false, error_code: 'credentials_missing' } },
        200,
        requestId,
      )
    }
  }

  return jsonResponse({ data: { ok: true, error_code: null } }, 200, requestId)
}

/** Map `/api/v1/{contacts|leads|clients}/…/email-messages` segment → stub entity type. */
export function entityTypeFromEmailPathSegment(
  segment: string,
): 'contact' | 'lead' | 'client' | null {
  switch (segment.toLowerCase()) {
    case 'contacts':
      return 'contact'
    case 'leads':
      return 'lead'
    case 'clients':
      return 'client'
    default:
      return null
  }
}

export async function listEntityEmailMessagesStub(
  db: DatabaseClient,
  orgId: string,
  entityType: 'contact' | 'lead' | 'client',
  entityId: string,
  requestId: string,
): Promise<Response> {
  // Wave A stub: ownership RLS exists; sync is Wave B. Return empty list after entity check.
  let data: { id: string } | null = null
  let error: { code?: string } | null = null
  if (entityType === 'contact') {
    ;({ data, error } = await db
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle())
  } else if (entityType === 'lead') {
    ;({ data, error } = await db
      .from('leads')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle())
  } else {
    ;({ data, error } = await db
      .from('clients')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle())
  }
  if (error) {
    console.error('Entity email list lookup failed', {
      request_id: requestId,
      code: error.code ?? 'unknown',
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Entity email list failed')
  }
  if (!data) throw new ApiError(404, 'NOT_FOUND', `${entityType} not found`)
  return jsonResponse({ data: [] as Json[] }, 200, requestId)
}

export function handleMailbox(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  assertCanAccessMailbox(role, req.method)

  if (path === '/api/v1/me/mailbox') {
    if (req.method === 'GET') return getMailbox(db, orgId, requestId)
    if (req.method === 'PUT') return putMailbox(req, db, orgId, requestId)
    if (req.method === 'DELETE') return deleteMailbox(db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for mailbox')
  }

  if (path === '/api/v1/me/mailbox/test') {
    if (req.method === 'POST') return testMailbox(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for mailbox test')
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
