import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import {
  type ImapProbeOptions,
  type ImapSecurity,
  ImapSyncError,
  isSyntheticImapHost,
  probeImap,
} from '../_shared/imap-inbound.ts'
import { resolveMailboxAuth } from '../_shared/mailbox-credentials.ts'
import {
  buildMailboxAuthUrl,
  exchangeMailboxAuthCode,
  isMailboxOAuthStubMode,
  type MailboxOAuthProvider,
  mailboxPresetHosts,
  randomOAuthState,
  serializeMailboxTokenBlob,
} from '../_shared/mailbox-oauth.ts'
import { ApiError, jsonBody, jsonResponse, parseLimit } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

const SECURITY = new Set(['tls', 'starttls', 'none'])

type ImapProbeFn = (options: ImapProbeOptions) => Promise<void>

let imapProbeFn: ImapProbeFn = probeImap

/** Test seam — pass null to restore the real IMAP probe. */
export function setImapProbeForTests(fn: ImapProbeFn | null): void {
  imapProbeFn = fn ?? probeImap
}

function serviceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Service credentials are unavailable')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function mailboxTestFailure(errorCode: string, message: string): {
  ok: false
  error_code: string
  message: string
} {
  return { ok: false, error_code: errorCode, message }
}

/** Reject CR/LF and other controls that could break IMAP protocol lines. */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

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

export type MailboxPatchBody = {
  sync_interval_minutes: number
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
  if (error.code === 'P0001' || message.includes('oauth state expired')) {
    return new ApiError(400, 'BAD_REQUEST', 'OAuth state expired — start connect again')
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
  if (!username || username.length > 320) {
    fields.username = 'Must be 1–320 characters'
  } else if (hasControlChars(username)) {
    // Control characters (esp. CR/LF) could be injected into IMAP protocol lines.
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

export function validateMailboxPatchBody(body: Record<string, unknown>): MailboxPatchBody {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'sync_interval_minutes') fields[key] = 'Field is not writable'
  }

  const syncInterval = typeof body.sync_interval_minutes === 'number'
    ? body.sync_interval_minutes
    : NaN
  if (!Number.isInteger(syncInterval) || syncInterval < 1 || syncInterval > 60) {
    fields.sync_interval_minutes = 'Must be an integer 1–60'
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Mailbox validation failed', fields)
  }
  return { sync_interval_minutes: syncInterval }
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
    } else if (hasControlChars(body.password)) {
      fields.password = 'Must not contain control characters'
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
  // Match JSON *keys* only. Values like config.auth_mode = "api_key" must not trip this.
  const text = JSON.stringify(payload)
  if (
    /"secret_ref"\s*:/.test(text) ||
    /"password"\s*:/.test(text) ||
    /"api_key"\s*:/.test(text) ||
    /"token_blob"\s*:/.test(text) ||
    /"access_token"\s*:/.test(text) ||
    /"refresh_token"\s*:/.test(text)
  ) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Mailbox response contained a forbidden secret field')
  }
}

function parseOAuthProvider(raw: string | null): MailboxOAuthProvider {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'microsoft' || value === 'outlook') return 'microsoft'
  if (value === 'google' || value === 'gmail') return 'google'
  throw new ApiError(422, 'VALIDATION_ERROR', 'provider must be microsoft or google', {
    provider: 'Must be microsoft or google',
  })
}

function validateOAuthCallbackParams(input: {
  code: string | null
  state: string | null
}): { code: string; state: string } {
  const fields: Record<string, string> = {}
  const code = input.code?.trim() ?? ''
  const state = input.state?.trim() ?? ''
  if (!code) fields.code = 'Required'
  if (!state || state.length < 16) fields.state = 'Must be at least 16 characters'
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'OAuth callback validation failed', fields)
  }
  return { code, state }
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

async function patchMailbox(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateMailboxPatchBody(await jsonBody(req))
  const { data, error } = await db.rpc('update_mailbox_sync_interval', {
    p_org_id: orgId,
    p_sync_interval_minutes: payload.sync_interval_minutes,
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
  // Live IMAP probe (LOGIN or XOAUTH2). Never log body / password / tokens.
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

  const { data: present, error } = await db.rpc('mailbox_credentials_present', {
    p_org_id: orgId,
    p_password: password,
  })
  if (error) throw databaseError(error, requestId)

  if (!present) {
    return jsonResponse(
      {
        data: mailboxTestFailure(
          'credentials_missing',
          'Mailbox credentials are missing — connect your account or save a password, then try Test again.',
        ),
      },
      200,
      requestId,
    )
  }

  const { data: mailbox, error: mailboxError } = await db.rpc('get_mailbox_account', {
    p_org_id: orgId,
  })
  if (mailboxError) throw databaseError(mailboxError, requestId)
  if (!mailbox || typeof mailbox !== 'object') {
    return jsonResponse(
      {
        data: mailboxTestFailure(
          'credentials_missing',
          'Mailbox credentials are missing — save mailbox settings, then try Test again.',
        ),
      },
      200,
      requestId,
    )
  }

  const row = mailbox as Record<string, unknown>
  const imapHost = String(row.imap_host ?? '')
  const username = String(row.username ?? '')
  const imapPort = Number(row.imap_port ?? 993)
  const securityRaw = String(row.imap_security ?? 'tls')
  const security: ImapSecurity = securityRaw === 'starttls' || securityRaw === 'none'
    ? securityRaw
    : 'tls'
  const authMode = row.auth_mode === 'oauth' ? 'oauth' : 'password'

  // Staging / unit synthetic hosts: credentials-present is enough (no network).
  if (isSyntheticImapHost(imapHost)) {
    return jsonResponse(
      {
        data: {
          ok: true,
          error_code: null,
          message: 'Synthetic mailbox host — credentials present (no network probe).',
        },
      },
      200,
      requestId,
    )
  }

  let probeOptions: ImapProbeOptions
  if (password) {
    probeOptions = {
      host: imapHost,
      port: imapPort,
      security,
      auth: { type: 'password', username, password },
    }
  } else if (authMode === 'oauth') {
    try {
      const service = serviceRoleClient()
      const resolved = await resolveMailboxAuth(service, String(row.id))
      if (!resolved) {
        return jsonResponse(
          {
            data: mailboxTestFailure(
              'credentials_missing',
              'Mailbox OAuth credentials are missing — reconnect your account, then try Test again.',
            ),
          },
          200,
          requestId,
        )
      }
      probeOptions = {
        host: imapHost,
        port: imapPort,
        security,
        auth: resolved.imapAuth,
      }
    } catch (err) {
      console.error('Mailbox OAuth resolve failed during test', {
        request_id: requestId,
        message: err instanceof Error ? err.message : 'unknown',
      })
      return jsonResponse(
        {
          data: mailboxTestFailure(
            'imap_auth_failed',
            'Sign-in failed — reconnect your Microsoft or Google account.',
          ),
        },
        200,
        requestId,
      )
    }
  } else {
    const service = serviceRoleClient()
    const resolved = await resolveMailboxAuth(service, String(row.id))
    if (!resolved || resolved.imapAuth.type !== 'password') {
      return jsonResponse(
        {
          data: mailboxTestFailure(
            'credentials_missing',
            'Mailbox credentials are missing — save a password, then try Test again.',
          ),
        },
        200,
        requestId,
      )
    }
    probeOptions = {
      host: imapHost,
      port: imapPort,
      security,
      auth: resolved.imapAuth,
    }
  }

  try {
    await imapProbeFn(probeOptions)
    return jsonResponse(
      {
        data: {
          ok: true,
          error_code: null,
          message: authMode === 'oauth' ? 'IMAP OAuth login succeeded.' : 'IMAP login succeeded.',
        },
      },
      200,
      requestId,
    )
  } catch (probeError) {
    if (probeError instanceof ImapSyncError) {
      const messages: Record<string, string> = {
        timeout: 'Mail server timed out — check host, port, security, and network path.',
        imap_auth_failed: authMode === 'oauth'
          ? 'Sign-in failed — reconnect your Microsoft or Google account.'
          : 'Sign-in failed — check the email address and password (or app password).',
        imap_tls_failed:
          'Secure connection failed — try a different security setting (SSL / STARTTLS).',
        imap_connection_failed:
          'Could not reach the mail server — check host, port, and security settings.',
        imap_host_blocked:
          'This mail host is not allowed — private, link-local, and metadata addresses are blocked.',
      }
      return jsonResponse(
        {
          data: mailboxTestFailure(
            probeError.code,
            messages[probeError.code] ?? `IMAP test failed (${probeError.code}).`,
          ),
        },
        200,
        requestId,
      )
    }
    console.error('Mailbox IMAP probe failed', { request_id: requestId })
    return jsonResponse(
      {
        data: mailboxTestFailure(
          'imap_connection_failed',
          'Could not reach the mail server — check host, port, and security settings.',
        ),
      },
      200,
      requestId,
    )
  }
}

async function oauthStart(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url)
  const provider = parseOAuthProvider(url.searchParams.get('provider'))
  const state = randomOAuthState()
  const { error } = await db.rpc('create_mailbox_oauth_state', {
    p_org_id: orgId,
    p_state: state,
    p_provider: provider,
    p_ttl_seconds: 600,
  })
  if (error) throw databaseError(error, requestId)

  if (isMailboxOAuthStubMode()) {
    const callback = new URL(
      `${url.origin}${url.pathname.replace(/\/oauth\/start$/, '/oauth/callback')}`,
    )
    const configured = provider === 'microsoft'
      ? Deno.env.get('MICROSOFT_MAILBOX_REDIRECT_URI')?.trim()
      : Deno.env.get('GOOGLE_MAILBOX_REDIRECT_URI')?.trim()
    const redirectBase = configured && configured.length > 0 ? configured : callback.toString()
    const stubUrl = new URL(redirectBase)
    stubUrl.searchParams.set('code', 'stub')
    stubUrl.searchParams.set('state', state)
    stubUrl.searchParams.set('provider', provider)
    return jsonResponse({ data: { url: stubUrl.toString(), state, provider } }, 200, requestId)
  }

  try {
    const authorizeUrl = buildMailboxAuthUrl({ provider, state })
    return jsonResponse(
      { data: { url: authorizeUrl, state, provider } },
      200,
      requestId,
    )
  } catch (err) {
    console.error('Mailbox OAuth start failed', {
      request_id: requestId,
      provider,
      message: err instanceof Error ? err.message : 'unknown',
    })
    throw new ApiError(
      503,
      'INTERNAL_ERROR',
      `${
        provider === 'microsoft' ? 'Microsoft' : 'Google'
      } mailbox OAuth is not configured on this environment`,
    )
  }
}

async function oauthCallback(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  let code: string | null = url.searchParams.get('code')
  let state: string | null = url.searchParams.get('state')
  if (req.method === 'POST') {
    try {
      const body = await req.json() as Record<string, unknown>
      if (typeof body.code === 'string') code = body.code
      if (typeof body.state === 'string') state = body.state
    } catch {
      // keep query params
    }
  }
  const params = validateOAuthCallbackParams({ code, state })

  const { data: consumed, error: consumeError } = await db.rpc('consume_mailbox_oauth_state', {
    p_org_id: orgId,
    p_state: params.state,
  })
  if (consumeError) throw databaseError(consumeError, requestId)
  const providerRaw = (consumed as { provider?: string } | null)?.provider ?? null
  const provider = parseOAuthProvider(providerRaw)

  let tokenBlob: string
  let accountEmail: string
  if (isMailboxOAuthStubMode() && params.code === 'stub') {
    accountEmail = provider === 'microsoft'
      ? 'mailbox-stub@outlook.example.test'
      : 'mailbox-stub@gmail.example.test'
    tokenBlob = serializeMailboxTokenBlob({
      stub: true,
      refresh_token: 'stub-refresh',
      access_token: 'stub-access',
      account_email: accountEmail,
    })
  } else {
    try {
      const exchanged = await exchangeMailboxAuthCode(provider, params.code)
      tokenBlob = serializeMailboxTokenBlob(exchanged)
      accountEmail = exchanged.account_email
    } catch (err) {
      console.error('Mailbox OAuth exchange failed', {
        request_id: requestId,
        provider,
        message: err instanceof Error ? err.message : 'unknown',
      })
      throw new ApiError(502, 'INTERNAL_ERROR', 'Mailbox OAuth token exchange failed')
    }
  }

  const hosts = mailboxPresetHosts(provider)
  const { data, error } = await db.rpc('upsert_mailbox_account_oauth', {
    p_org_id: orgId,
    p_provider: provider,
    p_token_blob: tokenBlob,
    p_email_address: accountEmail,
    p_from_name: null,
    p_imap_host: hosts.imap_host,
    p_imap_port: hosts.imap_port,
    p_imap_security: hosts.imap_security,
    p_smtp_host: hosts.smtp_host,
    p_smtp_port: hosts.smtp_port,
    p_smtp_security: hosts.smtp_security,
    p_username: accountEmail,
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

export async function listMyEmailMessages(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access personal email inbox')
  }
  if (req.method !== 'GET') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for personal email inbox')
  }

  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const { data, error } = await db.rpc('list_my_email_messages', {
    p_org_id: orgId,
    p_limit: limit,
  })
  if (error) {
    const message = error.message?.toLowerCase() ?? ''
    if (error.code === '42501' || message.includes('forbidden')) {
      throw new ApiError(403, 'FORBIDDEN', 'Personal email inbox is forbidden')
    }
    console.error('Personal email inbox list failed', {
      request_id: requestId,
      code: error.code ?? 'unknown',
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Personal email inbox list failed')
  }
  return jsonResponse({ data: (data ?? []) as Json[] }, 200, requestId)
}

export async function listEntityEmailMessages(
  db: DatabaseClient,
  orgId: string,
  entityType: 'contact' | 'lead' | 'client',
  entityId: string,
  requestId: string,
  limit = 50,
): Promise<Response> {
  // Wave B: entity existence check + ownership/share list RPC.
  let exists: { id: string } | null = null
  let lookupError: { code?: string } | null = null
  if (entityType === 'contact') {
    ;({ data: exists, error: lookupError } = await db
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle())
  } else if (entityType === 'lead') {
    ;({ data: exists, error: lookupError } = await db
      .from('leads')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle())
  } else {
    ;({ data: exists, error: lookupError } = await db
      .from('clients')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle())
  }
  if (lookupError) {
    console.error('Entity email list lookup failed', {
      request_id: requestId,
      code: lookupError.code ?? 'unknown',
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Entity email list failed')
  }
  if (!exists) throw new ApiError(404, 'NOT_FOUND', `${entityType} not found`)

  const { data, error } = await db.rpc('list_entity_email_messages', {
    p_org_id: orgId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_limit: limit,
  })
  if (error) {
    console.error('Entity email list failed', {
      request_id: requestId,
      code: error.code ?? 'unknown',
    })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Entity email list failed')
  }
  return jsonResponse({ data: (data ?? []) as Json[] }, 200, requestId)
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
    if (req.method === 'PATCH') return patchMailbox(req, db, orgId, requestId)
    if (req.method === 'DELETE') return deleteMailbox(db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for mailbox')
  }

  if (path === '/api/v1/me/mailbox/test') {
    if (req.method === 'POST') return testMailbox(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for mailbox test')
  }

  if (path === '/api/v1/me/mailbox/oauth/start') {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for mailbox OAuth start')
    }
    return oauthStart(db, orgId, requestId, req)
  }

  if (path === '/api/v1/me/mailbox/oauth/callback') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed for mailbox OAuth callback',
      )
    }
    return oauthCallback(req, db, orgId, requestId)
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
