/**
 * Mailbox OAuth helpers for Microsoft 365 / Outlook and Gmail.
 * Stores refresh+access token blobs; IMAP/SMTP use SASL XOAUTH2.
 */

export type MailboxOAuthProvider = 'microsoft' | 'google'

export type MailboxTokenBlob = {
  refresh_token?: string
  access_token?: string
  expiry?: string
  account_email?: string
  stub?: boolean
}

export type MailboxOAuthExchangeResult = MailboxTokenBlob & {
  account_email: string
}

const MICROSOFT_SCOPES = [
  'offline_access',
  'openid',
  'email',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ')

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://mail.google.com/',
].join(' ')

export function isMailboxOAuthStubMode(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): boolean {
  const flag = (getEnv('MAILBOX_OAUTH_STAGING_STUB') ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

export function parseMailboxTokenBlob(raw: string): MailboxTokenBlob {
  try {
    const parsed = JSON.parse(raw) as MailboxTokenBlob
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // treat as opaque refresh token
  }
  return { refresh_token: raw }
}

export function serializeMailboxTokenBlob(blob: MailboxTokenBlob): string {
  return JSON.stringify(blob)
}

/** SASL XOAUTH2 initial client response (base64). */
export function buildXoauth2SaslString(user: string, accessToken: string): string {
  const raw = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`
  return btoa(String.fromCharCode(...new TextEncoder().encode(raw)))
}

export function randomOAuthState(bytes = 24): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

function envForProvider(
  provider: MailboxOAuthProvider,
  getEnv: (key: string) => string | undefined,
): { clientId: string; clientSecret: string; redirectUri: string } {
  if (provider === 'microsoft') {
    const clientId = getEnv('MICROSOFT_MAILBOX_CLIENT_ID')?.trim() ?? ''
    const clientSecret = getEnv('MICROSOFT_MAILBOX_CLIENT_SECRET')?.trim() ?? ''
    const redirectUri = getEnv('MICROSOFT_MAILBOX_REDIRECT_URI')?.trim() ?? ''
    return { clientId, clientSecret, redirectUri }
  }
  const clientId = getEnv('GOOGLE_MAILBOX_CLIENT_ID')?.trim() ?? ''
  const clientSecret = getEnv('GOOGLE_MAILBOX_CLIENT_SECRET')?.trim() ?? ''
  const redirectUri = getEnv('GOOGLE_MAILBOX_REDIRECT_URI')?.trim() ?? ''
  return { clientId, clientSecret, redirectUri }
}

export function buildMailboxAuthUrl(options: {
  provider: MailboxOAuthProvider
  state: string
  getEnv?: (key: string) => string | undefined
}): string {
  const getEnv = options.getEnv ?? ((key) => Deno.env.get(key))
  const { clientId, redirectUri } = envForProvider(options.provider, getEnv)
  if (!clientId || !redirectUri) {
    throw new Error(`${options.provider} mailbox OAuth is not configured`)
  }

  if (options.provider === 'microsoft') {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: MICROSOFT_SCOPES,
      state: options.state,
      prompt: 'select_account',
    })
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: options.state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const payloadPart = idToken.split('.')[1]
    if (!payloadPart) return null
    const padded = payloadPart + '='.repeat((4 - (payloadPart.length % 4)) % 4)
    const payload = JSON.parse(
      atob(padded.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { email?: string; preferred_username?: string; upn?: string }
    for (const candidate of [payload.email, payload.preferred_username, payload.upn]) {
      const email = (candidate ?? '').trim().toLowerCase()
      if (email.includes('@')) return email
    }
  } catch {
    // ignore id_token parse errors
  }
  return null
}

async function fetchGoogleAccountEmail(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const res = await fetchImpl('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const json = await res.json() as { email?: string }
  const email = (json.email ?? '').trim().toLowerCase()
  return email.includes('@') ? email : null
}

function expiryFromExpiresIn(expiresIn: number | undefined): string | undefined {
  if (!expiresIn || !Number.isFinite(expiresIn)) return undefined
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

export async function exchangeMailboxAuthCode(
  provider: MailboxOAuthProvider,
  code: string,
  options: {
    getEnv?: (key: string) => string | undefined
    fetchImpl?: typeof fetch
  } = {},
): Promise<MailboxOAuthExchangeResult> {
  const getEnv = options.getEnv ?? ((key) => Deno.env.get(key))
  const fetchImpl = options.fetchImpl ?? fetch
  const { clientId, clientSecret, redirectUri } = envForProvider(provider, getEnv)
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(`${provider} mailbox OAuth is not configured`)
  }

  const tokenUrl = provider === 'microsoft'
    ? 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    : 'https://oauth2.googleapis.com/token'

  const res = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      ...(provider === 'microsoft' ? { scope: MICROSOFT_SCOPES } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`${provider} code exchange failed (${res.status})`)
  }
  const json = await res.json() as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    id_token?: string
  }
  if (!json.access_token && !json.refresh_token) {
    throw new Error(`${provider} code exchange missing tokens`)
  }

  // Microsoft IMAP/SMTP tokens are not Graph-scoped — prefer id_token email claims.
  let accountEmail = emailFromIdToken(json.id_token)
  if (!accountEmail && provider === 'google' && json.access_token) {
    accountEmail = await fetchGoogleAccountEmail(json.access_token, fetchImpl)
  }
  if (!accountEmail) {
    throw new Error(`${provider} code exchange did not return an account email`)
  }

  return {
    refresh_token: json.refresh_token,
    access_token: json.access_token,
    expiry: expiryFromExpiresIn(json.expires_in),
    account_email: accountEmail,
  }
}

export async function refreshMailboxAccessToken(
  provider: MailboxOAuthProvider,
  refreshToken: string,
  options: {
    getEnv?: (key: string) => string | undefined
    fetchImpl?: typeof fetch
  } = {},
): Promise<{ access_token: string; expiry?: string; refresh_token?: string }> {
  const getEnv = options.getEnv ?? ((key) => Deno.env.get(key))
  const fetchImpl = options.fetchImpl ?? fetch
  const { clientId, clientSecret } = envForProvider(provider, getEnv)
  if (!clientId || !clientSecret) {
    throw new Error(`${provider} mailbox OAuth is not configured`)
  }

  const tokenUrl = provider === 'microsoft'
    ? 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    : 'https://oauth2.googleapis.com/token'

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  if (provider === 'microsoft') {
    body.set('scope', MICROSOFT_SCOPES)
  }

  const res = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new Error(`${provider} token refresh failed (${res.status})`)
  }
  const json = await res.json() as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
  }
  if (!json.access_token) {
    throw new Error(`${provider} token refresh missing access_token`)
  }
  return {
    access_token: json.access_token,
    expiry: expiryFromExpiresIn(json.expires_in),
    refresh_token: json.refresh_token,
  }
}

export function accessTokenNeedsRefresh(blob: MailboxTokenBlob, skewMs = 60_000): boolean {
  if (!blob.access_token) return true
  if (!blob.expiry) return false
  const expiry = Date.parse(blob.expiry)
  if (Number.isNaN(expiry)) return true
  return expiry - skewMs <= Date.now()
}

/**
 * Ensure a usable access token; returns updated blob when refreshed.
 */
export async function ensureMailboxAccessToken(
  provider: MailboxOAuthProvider,
  blob: MailboxTokenBlob,
  options: {
    getEnv?: (key: string) => string | undefined
    fetchImpl?: typeof fetch
  } = {},
): Promise<{ accessToken: string; blob: MailboxTokenBlob; refreshed: boolean }> {
  if (blob.stub) {
    return {
      accessToken: blob.access_token ?? 'stub-access',
      blob,
      refreshed: false,
    }
  }

  if (!accessTokenNeedsRefresh(blob) && blob.access_token) {
    return { accessToken: blob.access_token, blob, refreshed: false }
  }

  const refreshToken = blob.refresh_token
  if (!refreshToken) {
    throw new Error(`${provider} mailbox refresh token is missing`)
  }

  const refreshed = await refreshMailboxAccessToken(provider, refreshToken, options)
  const next: MailboxTokenBlob = {
    ...blob,
    access_token: refreshed.access_token,
    expiry: refreshed.expiry,
    refresh_token: refreshed.refresh_token ?? blob.refresh_token,
  }
  return { accessToken: refreshed.access_token, blob: next, refreshed: true }
}

export function mailboxPresetHosts(provider: MailboxOAuthProvider): {
  imap_host: string
  imap_port: number
  imap_security: 'tls' | 'starttls' | 'none'
  smtp_host: string
  smtp_port: number
  smtp_security: 'tls' | 'starttls' | 'none'
} {
  if (provider === 'microsoft') {
    return {
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      imap_security: 'tls',
      smtp_host: 'smtp-mail.outlook.com',
      smtp_port: 587,
      smtp_security: 'starttls',
    }
  }
  return {
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_security: 'tls',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    smtp_security: 'tls',
  }
}
