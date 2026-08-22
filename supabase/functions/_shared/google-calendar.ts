/** Google Calendar Events API helper + staging stub for Cal-Sync-BE. */

export type GoogleTokenBlob = {
  refresh_token?: string
  access_token?: string
  expiry?: string
  stub?: boolean
}

export type GoogleEventInput = {
  title: string
  starts_at: string
  ends_at: string
  timezone: string
  location?: string | null
  meeting_url?: string | null
  description?: string | null
}

export type GoogleCalendarClient = {
  insertEvent: (
    calendarId: string,
    event: GoogleEventInput,
  ) => Promise<{ id: string }>
  patchEvent: (
    calendarId: string,
    eventId: string,
    event: GoogleEventInput,
  ) => Promise<{ id: string }>
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>
}

export function isCalendarSyncStubMode(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): boolean {
  const flag = (getEnv('CALENDAR_SYNC_STAGING_STUB') ?? '').trim()
    .toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

export function parseTokenBlob(raw: string): GoogleTokenBlob {
  try {
    const parsed = JSON.parse(raw) as GoogleTokenBlob
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // treat as opaque refresh token string
  }
  return { refresh_token: raw }
}

export function serializeTokenBlob(blob: GoogleTokenBlob): string {
  return JSON.stringify(blob)
}

function eventBody(event: GoogleEventInput): Record<string, unknown> {
  const descriptionParts: string[] = []
  if (event.meeting_url) {
    descriptionParts.push(`Meeting URL: ${event.meeting_url}`)
  }
  if (event.description) descriptionParts.push(event.description)
  return {
    summary: event.title,
    location: event.location ?? undefined,
    description: descriptionParts.length > 0 ? descriptionParts.join('\n\n') : undefined,
    start: {
      dateTime: event.starts_at,
      timeZone: event.timezone,
    },
    end: {
      dateTime: event.ends_at,
      timeZone: event.timezone,
    },
  }
}

export function createStubGoogleCalendarClient(
  meetingIdForStub?: string,
): GoogleCalendarClient {
  return {
    insertEvent(_calendarId, _event) {
      const suffix = meetingIdForStub ?? crypto.randomUUID()
      return Promise.resolve({ id: `stub-${suffix}` })
    },
    patchEvent(_calendarId, eventId, _event) {
      return Promise.resolve({ id: eventId })
    },
    deleteEvent(_calendarId, _eventId) {
      return Promise.resolve()
    },
  }
}

async function refreshAccessToken(
  refreshToken: string,
  getEnv: (key: string) => string | undefined,
): Promise<{ access_token: string; expiry?: string }> {
  const clientId = getEnv('GOOGLE_CALENDAR_CLIENT_ID')
  const clientSecret = getEnv('GOOGLE_CALENDAR_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar OAuth client is not configured')
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status})`)
  }
  const json = await res.json() as {
    access_token?: string
    expires_in?: number
  }
  if (!json.access_token) {
    throw new Error('Google token refresh missing access_token')
  }
  const expiry = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : undefined
  return { access_token: json.access_token, expiry }
}

async function ensureAccessToken(
  blob: GoogleTokenBlob,
  getEnv: (key: string) => string | undefined,
  onRotate?: (next: GoogleTokenBlob) => Promise<void>,
): Promise<string> {
  if (blob.stub) throw new Error('Stub token used with live Google client')
  const now = Date.now()
  const expiryMs = blob.expiry ? Date.parse(blob.expiry) : NaN
  if (
    blob.access_token && Number.isFinite(expiryMs) && expiryMs > now + 60_000
  ) {
    return blob.access_token
  }
  if (!blob.refresh_token) throw new Error('Missing Google refresh_token')
  const refreshed = await refreshAccessToken(blob.refresh_token, getEnv)
  const next: GoogleTokenBlob = {
    ...blob,
    access_token: refreshed.access_token,
    expiry: refreshed.expiry,
  }
  if (onRotate) await onRotate(next)
  return refreshed.access_token
}

export function createLiveGoogleCalendarClient(
  blob: GoogleTokenBlob,
  options: {
    getEnv?: (key: string) => string | undefined
    onRotate?: (next: GoogleTokenBlob) => Promise<void>
    fetchImpl?: typeof fetch
  } = {},
): GoogleCalendarClient {
  const getEnv = options.getEnv ?? ((key) => Deno.env.get(key))
  const fetchImpl = options.fetchImpl ?? fetch

  async function api(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const access = await ensureAccessToken(blob, getEnv, options.onRotate)
    return fetchImpl(`https://www.googleapis.com/calendar/v3${path}`, {
      method,
      headers: {
        authorization: `Bearer ${access}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  return {
    async insertEvent(calendarId, event) {
      const res = await api(
        'POST',
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        eventBody(event),
      )
      if (!res.ok) throw new Error(`Google insertEvent failed (${res.status})`)
      const json = await res.json() as { id?: string }
      if (!json.id) throw new Error('Google insertEvent missing id')
      return { id: json.id }
    },
    async patchEvent(calendarId, eventId, event) {
      const res = await api(
        'PATCH',
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        eventBody(event),
      )
      if (!res.ok) throw new Error(`Google patchEvent failed (${res.status})`)
      const json = await res.json() as { id?: string }
      return { id: json.id ?? eventId }
    },
    async deleteEvent(calendarId, eventId) {
      const res = await api(
        'DELETE',
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      )
      // 404/410 = already gone — treat as success for clear path
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        throw new Error(`Google deleteEvent failed (${res.status})`)
      }
    },
  }
}

export function buildGoogleAuthUrl(options: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
    state: options.state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGoogleAuthCode(
  code: string,
  options: {
    getEnv?: (key: string) => string | undefined
    fetchImpl?: typeof fetch
  } = {},
): Promise<GoogleTokenBlob & { account_email?: string }> {
  const getEnv = options.getEnv ?? ((key) => Deno.env.get(key))
  const fetchImpl = options.fetchImpl ?? fetch
  const clientId = getEnv('GOOGLE_CALENDAR_CLIENT_ID')
  const clientSecret = getEnv('GOOGLE_CALENDAR_CLIENT_SECRET')
  const redirectUri = getEnv('GOOGLE_CALENDAR_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google Calendar OAuth client is not configured')
  }
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google code exchange failed (${res.status})`)
  const json = await res.json() as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.refresh_token && !json.access_token) {
    throw new Error('Google code exchange missing tokens')
  }
  const expiry = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : undefined
  return {
    refresh_token: json.refresh_token,
    access_token: json.access_token,
    expiry,
  }
}
