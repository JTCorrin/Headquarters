import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import {
  CaldavError,
  createCaldavClient,
  hostnameFromCaldavUrl,
  isSyntheticCaldavHost,
  parseCaldavSecretBlob,
} from '../_shared/caldav.ts'
import type { Database } from '../_shared/database.ts'
import {
  buildGoogleAuthUrl,
  exchangeGoogleAuthCode,
  isCalendarSyncStubMode,
  serializeTokenBlob,
} from '../_shared/google-calendar.ts'
import { assertSafeOutboundHost } from '../_shared/imap-inbound.ts'
import { ApiError, jsonBody, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

function assertCanReadCalendar(role: MembershipRole): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access calendar sync')
  }
}

function assertCanWriteCalendar(role: MembershipRole): void {
  assertCanReadCalendar(role)
  if (role === 'readonly') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot connect calendar sync')
  }
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Calendar operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Calendar connection not found')
  }
  if (error.code === 'P0001' || message.includes('expired')) {
    return new ApiError(400, 'VALIDATION_ERROR', error.message ?? 'OAuth state expired')
  }
  if (error.code === '22023' || message.includes('password is required')) {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'Calendar validation failed')
  }
  console.error('Calendar operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The calendar operation failed')
}

/** True when payload JSON includes forbidden secret *keys*. */
export function calendarPayloadHasForbiddenSecretKey(payload: unknown): boolean {
  const text = JSON.stringify(payload)
  return (
    /"secret_ref"\s*:/.test(text) ||
    /"password"\s*:/.test(text) ||
    /"api_key"\s*:/.test(text) ||
    /"refresh_token"\s*:/.test(text) ||
    /"access_token"\s*:/.test(text) ||
    /"token_blob"\s*:/.test(text)
  )
}

function assertNoSecretEcho(payload: unknown): void {
  if (calendarPayloadHasForbiddenSecretKey(payload)) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Calendar response contained a forbidden secret field',
    )
  }
}

function randomState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
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

export function validateOAuthCallbackParams(input: {
  code: string | null
  state: string | null
}): { code: string; state: string } {
  const fields: Record<string, string> = {}
  const code = input.code?.trim() ?? ''
  const state = input.state?.trim() ?? ''
  if (code.length < 1) fields.code = 'Required'
  if (state.length < 16) fields.state = 'Must be a valid OAuth state'
  if (Object.keys(fields).length > 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'OAuth callback validation failed', fields)
  }
  return { code, state }
}

export type CaldavUpsertBody = {
  provider: 'caldav'
  caldav_url: string
  username: string
  password: string | null
  calendar_id: string | null
}

export function validateCaldavUpsertBody(body: Record<string, unknown>): CaldavUpsertBody {
  const fields: Record<string, string> = {}
  const writable = new Set(['provider', 'caldav_url', 'username', 'password', 'calendar_id'])
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Field is not writable'
  }

  if (body.provider !== 'caldav') {
    fields.provider = 'Must be caldav for credential connect'
  }

  const caldavUrl = typeof body.caldav_url === 'string' ? body.caldav_url.trim() : ''
  if (!caldavUrl || caldavUrl.length < 8 || caldavUrl.length > 2000) {
    fields.caldav_url = 'Must be a CalDAV URL (8–2000 characters)'
  } else {
    try {
      hostnameFromCaldavUrl(caldavUrl)
    } catch {
      fields.caldav_url = 'Must be a valid http(s) CalDAV URL'
    }
  }

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

  let calendarId: string | null = null
  if ('calendar_id' in body) {
    if (body.calendar_id === null || body.calendar_id === undefined) {
      calendarId = null
    } else if (typeof body.calendar_id === 'string') {
      const trimmed = body.calendar_id.trim()
      if (trimmed.length === 0) {
        calendarId = null
      } else if (trimmed.length > 500) {
        fields.calendar_id = 'Must be at most 500 characters'
      } else {
        calendarId = trimmed
      }
    } else {
      fields.calendar_id = 'Must be a string or null'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'CalDAV validation failed', fields)
  }

  return {
    provider: 'caldav',
    caldav_url: caldavUrl,
    username,
    password,
    calendar_id: calendarId,
  }
}

function parseProviderQuery(url: URL, fallback: string | null): string | null {
  const raw = url.searchParams.get('provider')
  if (raw == null || raw.trim() === '') return fallback
  const provider = raw.trim().toLowerCase()
  if (provider !== 'google' && provider !== 'caldav') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'provider must be google or caldav')
  }
  return provider
}

function toPublicCalendarStatus(row: Record<string, unknown>): Record<string, unknown> {
  const provider = typeof row.provider === 'string' ? row.provider : 'google'
  const config = (row.config && typeof row.config === 'object')
    ? row.config as Record<string, unknown>
    : provider === 'caldav'
    ? {
      caldav_url: row.caldav_url ?? null,
      username: row.account_email ?? null,
      calendar_id: row.calendar_id ?? 'default',
    }
    : {
      account_email: row.account_email ?? null,
      calendar_id: row.calendar_id ?? 'primary',
    }

  return {
    provider,
    status: row.status,
    credentials_configured: row.credentials_configured === true,
    config,
    account_email: row.account_email ?? null,
    calendar_id: row.calendar_id ?? (provider === 'caldav' ? 'default' : 'primary'),
    caldav_url: provider === 'caldav' ? (row.caldav_url ?? null) : undefined,
    last_error_code: row.last_error_code ?? null,
    last_sync_at: row.last_sync_at ?? null,
  }
}

async function getCalendar(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
  provider: string | null,
): Promise<Response> {
  const { data, error } = await db.rpc('get_calendar_connection', {
    p_org_id: orgId,
    p_provider: provider,
  })
  if (error) throw databaseError(error, requestId)
  if (data == null) {
    return jsonResponse(
      {
        data: {
          provider: provider ?? 'google',
          status: 'disconnected',
          credentials_configured: false,
          config: {},
        },
      },
      200,
      requestId,
    )
  }
  assertNoSecretEcho(data)
  return jsonResponse(
    { data: toPublicCalendarStatus(data as Record<string, unknown>) },
    200,
    requestId,
  )
}

async function putCalendar(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateCaldavUpsertBody(await jsonBody(req) as Record<string, unknown>)

  // SSRF gate before vault write — reject private hosts early.
  const host = hostnameFromCaldavUrl(payload.caldav_url)
  if (!isSyntheticCaldavHost(host)) {
    try {
      await assertSafeOutboundHost(host)
    } catch (err) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        err instanceof Error ? err.message : 'CalDAV host is not allowed',
        { caldav_url: 'Host is not allowed (private or internal)' },
      )
    }
  }

  const { data, error } = await db.rpc('upsert_calendar_caldav_connection', {
    p_org_id: orgId,
    p_caldav_url: payload.caldav_url,
    p_username: payload.username,
    p_password: payload.password,
    p_calendar_id: payload.calendar_id,
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse(
    { data: toPublicCalendarStatus(data as Record<string, unknown>) },
    200,
    requestId,
  )
}

async function deleteCalendar(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
  provider: string,
): Promise<Response> {
  const { error } = await db.rpc('disconnect_calendar_connection', {
    p_org_id: orgId,
    p_provider: provider,
  })
  if (error) throw databaseError(error, requestId)
  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

async function testCalendar(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  let passwordOverride: string | null = null
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
      const body = parsed as Record<string, unknown>
      for (const key of Object.keys(body)) {
        if (key !== 'password') {
          throw new ApiError(422, 'VALIDATION_ERROR', 'CalDAV test validation failed', {
            [key]: 'Field is not writable',
          })
        }
      }
      if ('password' in body) {
        if (typeof body.password !== 'string' || body.password.length === 0) {
          throw new ApiError(422, 'VALIDATION_ERROR', 'CalDAV test validation failed', {
            password: 'Must be a non-empty string when provided',
          })
        }
        if (hasControlChars(body.password) || body.password.length > 512) {
          throw new ApiError(422, 'VALIDATION_ERROR', 'CalDAV test validation failed', {
            password: 'Invalid password',
          })
        }
        passwordOverride = body.password
      }
    }
  }

  const { data, error } = await db.rpc('get_calendar_connection', {
    p_org_id: orgId,
    p_provider: 'caldav',
  })
  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object') {
    return jsonResponse(
      {
        data: {
          ok: false,
          error_code: 'credentials_missing',
          message: 'CalDAV connection is missing — save settings, then try Test again.',
        },
      },
      200,
      requestId,
    )
  }

  const row = data as Record<string, unknown>
  const caldavUrl = typeof row.caldav_url === 'string'
    ? row.caldav_url
    : typeof (row.config as Record<string, unknown> | undefined)?.caldav_url === 'string'
    ? String((row.config as Record<string, unknown>).caldav_url)
    : ''
  const username = typeof row.account_email === 'string' ? row.account_email : ''

  if (!caldavUrl || !username || row.credentials_configured !== true) {
    return jsonResponse(
      {
        data: {
          ok: false,
          error_code: 'credentials_missing',
          message: 'CalDAV credentials are missing — save a password, then try Test again.',
        },
      },
      200,
      requestId,
    )
  }

  let host: string
  try {
    host = hostnameFromCaldavUrl(caldavUrl)
  } catch {
    return jsonResponse(
      {
        data: {
          ok: false,
          error_code: 'caldav_url_invalid',
          message: 'CalDAV URL is invalid.',
        },
      },
      200,
      requestId,
    )
  }

  if (isSyntheticCaldavHost(host)) {
    return jsonResponse(
      {
        data: {
          ok: true,
          error_code: null,
          message: 'Synthetic CalDAV host — credentials present (no network probe).',
        },
      },
      200,
      requestId,
    )
  }

  let password = passwordOverride
  if (!password) {
    const connectionId = typeof row.id === 'string' ? row.id : null
    if (!connectionId) {
      return jsonResponse(
        {
          data: {
            ok: false,
            error_code: 'credentials_missing',
            message: 'CalDAV credentials are missing — save a password, then try Test again.',
          },
        },
        200,
        requestId,
      )
    }
    const service = serviceRoleClient()
    const { data: creds, error: credError } = await service.rpc(
      'read_calendar_connection_credentials',
      { p_connection_id: connectionId },
    )
    if (credError) throw databaseError(credError, requestId)
    const blob = (creds as { token_blob?: string | null } | null)?.token_blob
    password = blob ? (parseCaldavSecretBlob(blob).password ?? null) : null
  }

  if (!password) {
    return jsonResponse(
      {
        data: {
          ok: false,
          error_code: 'credentials_missing',
          message: 'CalDAV credentials are missing — save a password, then try Test again.',
        },
      },
      200,
      requestId,
    )
  }

  try {
    const client = await createCaldavClient({
      caldavUrl,
      username,
      password,
    })
    await client.propfind()
    return jsonResponse(
      {
        data: {
          ok: true,
          error_code: null,
          message: 'CalDAV PROPFIND succeeded.',
        },
      },
      200,
      requestId,
    )
  } catch (err) {
    const code = err instanceof CaldavError ? err.code : 'caldav_propfind_failed'
    return jsonResponse(
      {
        data: {
          ok: false,
          error_code: code,
          message: err instanceof Error ? err.message : 'CalDAV test failed.',
        },
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
  const state = randomState()
  const { error } = await db.rpc('create_calendar_oauth_state', {
    p_org_id: orgId,
    p_state: state,
    p_ttl_seconds: 600,
  })
  if (error) throw databaseError(error, requestId)

  if (isCalendarSyncStubMode()) {
    const url = new URL(req.url)
    // Point stub redirect at our callback so curl can complete without Google.
    const callback = new URL(
      `${url.origin}${url.pathname.replace(/\/oauth\/start$/, '/oauth/callback')}`,
    )
    // Prefer configured redirect when present (matches live Google app).
    const configured = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')?.trim()
    const redirectBase = configured && configured.length > 0 ? configured : callback.toString()
    const stubUrl = new URL(redirectBase)
    stubUrl.searchParams.set('code', 'stub')
    stubUrl.searchParams.set('state', state)
    return jsonResponse({ data: { url: stubUrl.toString(), state } }, 200, requestId)
  }

  const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')?.trim()
  const redirectUri = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')?.trim()
  if (!clientId || !redirectUri) {
    throw new ApiError(
      503,
      'INTERNAL_ERROR',
      'Google Calendar OAuth is not configured on this environment',
    )
  }
  const url = buildGoogleAuthUrl({ clientId, redirectUri, state })
  return jsonResponse({ data: { url, state } }, 200, requestId)
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

  const { error: consumeError } = await db.rpc('consume_calendar_oauth_state', {
    p_org_id: orgId,
    p_state: params.state,
  })
  if (consumeError) throw databaseError(consumeError, requestId)

  let tokenBlob: string
  let accountEmail: string | null = null
  if (isCalendarSyncStubMode() && params.code === 'stub') {
    tokenBlob = serializeTokenBlob({
      stub: true,
      refresh_token: 'stub-refresh',
      access_token: 'stub-access',
    })
    accountEmail = 'calendar-stub@example.test'
  } else {
    try {
      const exchanged = await exchangeGoogleAuthCode(params.code)
      tokenBlob = serializeTokenBlob(exchanged)
      accountEmail = exchanged.account_email ?? null
    } catch (err) {
      console.error('Google OAuth exchange failed', {
        request_id: requestId,
        message: err instanceof Error ? err.message : 'unknown',
      })
      throw new ApiError(502, 'INTERNAL_ERROR', 'Google OAuth token exchange failed')
    }
  }

  const { data, error } = await db.rpc('upsert_calendar_connection_tokens', {
    p_org_id: orgId,
    p_token_blob: tokenBlob,
    p_account_email: accountEmail,
    p_external_account_id: accountEmail,
    p_calendar_id: 'primary',
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse(
    { data: toPublicCalendarStatus(data as Record<string, unknown>) },
    200,
    requestId,
  )
}

export function handleCalendar(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)

  if (path === '/api/v1/me/calendar') {
    if (req.method === 'GET') {
      assertCanReadCalendar(role)
      const provider = parseProviderQuery(url, null)
      return getCalendar(db, orgId, requestId, provider)
    }
    if (req.method === 'PUT') {
      assertCanWriteCalendar(role)
      return putCalendar(req, db, orgId, requestId)
    }
    if (req.method === 'DELETE') {
      assertCanWriteCalendar(role)
      const provider = parseProviderQuery(url, 'google')
      return deleteCalendar(db, orgId, requestId, provider ?? 'google')
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for calendar')
  }

  if (path === '/api/v1/me/calendar/test') {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for calendar test')
    }
    assertCanWriteCalendar(role)
    return testCalendar(req, db, orgId, requestId)
  }

  if (path === '/api/v1/me/calendar/oauth/start') {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for calendar OAuth start')
    }
    assertCanWriteCalendar(role)
    return oauthStart(db, orgId, requestId, req)
  }

  if (path === '/api/v1/me/calendar/oauth/callback') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed for calendar OAuth callback',
      )
    }
    assertCanWriteCalendar(role)
    return oauthCallback(req, db, orgId, requestId)
  }

  throw new ApiError(404, 'NOT_FOUND', 'Calendar route not found')
}
