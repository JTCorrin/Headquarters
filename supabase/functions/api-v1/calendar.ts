import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import {
  buildGoogleAuthUrl,
  exchangeGoogleAuthCode,
  isCalendarSyncStubMode,
  serializeTokenBlob,
} from '../_shared/google-calendar.ts'
import { ApiError, jsonResponse } from './http.ts'

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
  if (error.code === '22023') {
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

async function getCalendar(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('get_calendar_connection', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  if (data == null) {
    return jsonResponse(
      {
        data: {
          provider: 'google',
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
  const row = data as Record<string, unknown>
  return jsonResponse(
    {
      data: {
        provider: row.provider ?? 'google',
        status: row.status,
        credentials_configured: row.credentials_configured === true,
        config: row.config ?? {
          account_email: row.account_email ?? null,
          calendar_id: row.calendar_id ?? 'primary',
        },
        account_email: row.account_email ?? null,
        calendar_id: row.calendar_id ?? 'primary',
        last_error_code: row.last_error_code ?? null,
        last_sync_at: row.last_sync_at ?? null,
      },
    },
    200,
    requestId,
  )
}

async function deleteCalendar(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { error } = await db.rpc('disconnect_calendar_connection', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
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
  return jsonResponse({ data }, 200, requestId)
}

export function handleCalendar(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/me/calendar') {
    if (req.method === 'GET') {
      assertCanReadCalendar(role)
      return getCalendar(db, orgId, requestId)
    }
    if (req.method === 'DELETE') {
      assertCanWriteCalendar(role)
      return deleteCalendar(db, orgId, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for calendar')
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
