/**
 * Bounded IMAP inbound fetch for mailbox sync.
 * Supports tls / starttls / none. Body truncated to maxBodyBytes; attachments not fetched.
 * Connect / command / overall deadlines map to error code `timeout` (not imap_connection_failed).
 */

export type ImapSecurity = 'tls' | 'starttls' | 'none'

/** Defaults — Edge sync/probe should finish or fail honestly before platform kill. */
export const IMAP_CONNECT_TIMEOUT_MS = 10_000
export const IMAP_COMMAND_TIMEOUT_MS = 30_000
export const IMAP_PROBE_TIMEOUT_MS = 15_000
export const IMAP_SYNC_OVERALL_TIMEOUT_MS = 90_000

export type ImapTimeoutOptions = {
  connectTimeoutMs?: number
  commandTimeoutMs?: number
  overallTimeoutMs?: number
}

export type ImapFetchOptions = {
  host: string
  port: number
  security: ImapSecurity
  username: string
  password: string
  lookbackDays: number
  maxMessages: number
  maxBodyBytes: number
} & ImapTimeoutOptions

export type ImapProbeOptions = {
  host: string
  port: number
  security: ImapSecurity
  username: string
  password: string
} & ImapTimeoutOptions

export type InboundImapMessage = {
  provider_message_id: string
  provider_thread_id: string | null
  from_address: string
  from_name: string | null
  to_addresses: Array<{ email: string; name: string | null }>
  subject: string
  body_text: string
  preview_text: string
  received_at: string
  body_truncated: boolean
}

export class ImapSyncError extends Error {
  readonly code: string
  readonly authFailed: boolean
  /** Sync pipeline step hint for API clients (connect/login/select/search/fetch/…). */
  readonly step: string | null

  constructor(code: string, message: string, authFailed = false, step: string | null = null) {
    super(message)
    this.name = 'ImapSyncError'
    this.code = code
    this.authFailed = authFailed
    this.step = step
  }
}

/**
 * Max UIDs per UID FETCH command (keeps each command under the command deadline).
 * Held at 1 until Mailcow/Dovecot FETCH literal framing is proven stable in staging.
 */
export const IMAP_FETCH_BATCH_SIZE = 1

/** Split UIDs into batches of 1–5 (default {@link IMAP_FETCH_BATCH_SIZE}). */
export function chunkUids(uids: number[], batchSize = IMAP_FETCH_BATCH_SIZE): number[][] {
  const size = Math.max(1, Math.min(5, Math.floor(batchSize)))
  const batches: number[][] = []
  for (let i = 0; i < uids.length; i += size) {
    batches.push(uids.slice(i, i + size))
  }
  return batches
}

export function isSyntheticImapHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === 'imap.example.test' || h.endsWith('.example.test')
}

function timeoutStepFromLabel(label: string): string | null {
  const lower = label.toLowerCase()
  if (lower.includes('fetch')) return 'fetch'
  if (lower.includes('search')) return 'search'
  if (lower.includes('select')) return 'select'
  if (lower.includes('login') || lower.includes('probe')) return 'login'
  if (lower.includes('connect') || lower.includes('greeting') || lower.includes('starttls')) {
    return 'connect'
  }
  if (lower.includes('sync')) return 'sync'
  return null
}

/** Race a promise against a deadline; maps expiry / AbortError → `timeout`. */
export async function withImapTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  step: string | null = timeoutStepFromLabel(label),
): Promise<T> {
  const budget = Math.max(1, Math.floor(ms))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ImapSyncError('timeout', `${label} timed out after ${budget}ms`, false, step))
        }, budget)
      }),
    ])
  } catch (error) {
    if (error instanceof ImapSyncError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ImapSyncError('timeout', `${label} timed out after ${budget}ms`, false, step)
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/timed?\s*out|aborted|abort/i.test(message)) {
      throw new ImapSyncError('timeout', `${label} timed out after ${budget}ms`, false, step)
    }
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Short safe copy for Sync API clients (no host/password/body). */
export function safeMailboxSyncFailureMessage(
  code: string,
  step: string | null = null,
): { message: string; step: string | null } {
  const resolvedStep = step ??
    ({
      imap_auth_failed: 'login',
      imap_select_failed: 'select',
      imap_search_failed: 'search',
      imap_fetch_failed: 'fetch',
      imap_tls_failed: 'connect',
      imap_connection_failed: 'connect',
      credentials_missing: 'credentials',
      lease_error: 'lease',
      not_claimed: 'lease',
      timeout: null,
      sync_failed: 'sync',
    }[code] ?? null)

  const byCode: Record<string, string> = {
    timeout: resolvedStep
      ? `Mailbox sync timed out during ${resolvedStep}. Try Sync again, or reduce inbox load.`
      : 'Mailbox sync timed out. Try Sync again, or reduce inbox load.',
    imap_auth_failed: 'IMAP sign-in failed — check email and password (or app password).',
    imap_select_failed: 'Could not open the inbox (SELECT failed).',
    imap_search_failed: 'Could not search the inbox for recent messages.',
    imap_fetch_failed: 'Could not download message contents from the mail server.',
    imap_tls_failed:
      'Secure connection failed — try a different security setting (SSL / STARTTLS).',
    imap_connection_failed:
      'Could not reach the mail server — check host, port, and security settings.',
    credentials_missing: 'Mailbox credentials are missing — save a password, then try Sync again.',
    lease_error: 'Could not start sync — try again in a moment.',
    not_claimed: 'Another sync is already running — wait a moment and try again.',
    sync_failed: 'Mailbox sync failed — try again or check mailbox settings.',
  }

  return {
    message: byCode[code] ?? `Mailbox sync failed (${code}).`,
    step: resolvedStep,
  }
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** IMAP SEARCH SINCE date: `01-Jan-2026` (UTC calendar day). */
export function formatImapSinceDate(lookbackDays: number, now = new Date()): string {
  const d = new Date(now.getTime() - Math.max(lookbackDays, 0) * 86_400_000)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day}-${month}-${year}`
}

export function parseAddressList(headerValue: string | undefined): Array<{
  email: string
  name: string | null
}> {
  if (!headerValue?.trim()) return []
  const results: Array<{ email: string; name: string | null }> = []
  const parts: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of headerValue) {
    if (ch === '"') inQuotes = !inQuotes
    if (ch === ',' && !inQuotes) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current)

  for (const part of parts) {
    const angle = part.match(/^(.*?)<([^>]+)>\s*$/)
    if (angle) {
      const email = angle[2].trim().toLowerCase()
      const rawName = angle[1].trim().replace(/^"|"$/g, '')
      if (email.includes('@')) results.push({ email, name: rawName || null })
      continue
    }
    const email = part.trim().replace(/^<|>$/g, '').toLowerCase()
    if (email.includes('@')) results.push({ email, name: null })
  }
  return results
}

export function parseHeaderBlock(raw: string): Record<string, string> {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
  const headers: Record<string, string> = {}
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (!key) continue
    if (headers[key]) headers[key] += `, ${value}`
    else headers[key] = value
  }
  return headers
}

function quoteImapString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export type ImapByteConn = {
  read(p: Uint8Array): Promise<number | null>
  write(p: Uint8Array): Promise<number>
  close(): void
}

type ByteConn = ImapByteConn

/**
 * Test helper: run one IMAP command against a scripted byte stream.
 * Caller supplies the server response (no greeting); first tag is A0001.
 */
export async function runImapCommandForTests(
  conn: ImapByteConn,
  payload: string,
  label = 'IMAP FETCH',
  commandTimeoutMs = 5_000,
): Promise<{ status: string; text: string; untagged: string[] }> {
  const session = new ImapSession(conn, commandTimeoutMs)
  try {
    return await session.command(payload, label)
  } finally {
    session.close()
  }
}

class ImapSession {
  private conn: ByteConn
  private buffer = new Uint8Array(0)
  private tagSeq = 0
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private readonly commandTimeoutMs: number

  constructor(conn: ByteConn, commandTimeoutMs = IMAP_COMMAND_TIMEOUT_MS) {
    this.conn = conn
    this.commandTimeoutMs = commandTimeoutMs
  }

  close() {
    try {
      this.conn.close()
    } catch {
      /* ignore */
    }
  }

  private async fill(minBytes: number): Promise<void> {
    while (this.buffer.length < minBytes) {
      const chunk = new Uint8Array(8192)
      const n = await this.conn.read(chunk)
      if (n === null) {
        throw new ImapSyncError('imap_connection_failed', 'IMAP connection closed')
      }
      const next = new Uint8Array(this.buffer.length + n)
      next.set(this.buffer)
      next.set(chunk.subarray(0, n), this.buffer.length)
      this.buffer = next
    }
  }

  private async readLineBytes(): Promise<Uint8Array> {
    while (true) {
      for (let i = 0; i < this.buffer.length - 1; i++) {
        if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a) {
          const line = this.buffer.subarray(0, i)
          this.buffer = this.buffer.subarray(i + 2)
          return line
        }
      }
      await this.fill(this.buffer.length + 1)
    }
  }

  private async readExact(n: number): Promise<Uint8Array> {
    await this.fill(n)
    const out = this.buffer.subarray(0, n)
    this.buffer = this.buffer.subarray(n)
    return out
  }

  async readGreeting(): Promise<void> {
    const line = this.decoder.decode(await this.readLineBytes())
    if (!/^\* (OK|PREAUTH)/i.test(line)) {
      throw new ImapSyncError('imap_connection_failed', `Unexpected IMAP greeting: ${line}`)
    }
  }

  async command(
    payload: string,
    label = 'IMAP command',
  ): Promise<{ status: string; text: string; untagged: string[] }> {
    return await withImapTimeout(this.commandInner(payload), this.commandTimeoutMs, label)
  }

  private async commandInner(
    payload: string,
  ): Promise<{ status: string; text: string; untagged: string[] }> {
    const tag = `A${String(++this.tagSeq).padStart(4, '0')}`
    await this.conn.write(this.encoder.encode(`${tag} ${payload}\r\n`))

    const untagged: string[] = []
    while (true) {
      let line = this.decoder.decode(await this.readLineBytes())

      const literalMatch = line.match(/\{(\d+)\}$/)
      if (literalMatch) {
        const size = Number(literalMatch[1])
        // RFC 3501: `{n} CRLF` then exactly n octets; response continues immediately
        // (often `)` or the next BODY token). Do NOT consume a phantom post-literal CRLF.
        const literal = await this.readExact(size)
        line = `${line}\n${this.decoder.decode(literal)}`
        untagged.push(line)
        continue
      }

      if (line.startsWith('* ') || line.startsWith('+ ')) {
        untagged.push(line)
        continue
      }

      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1)
        const status = rest.split(/\s+/, 1)[0]?.toUpperCase() ?? 'BAD'
        return { status, text: rest, untagged }
      }

      untagged.push(line)
    }
  }
}

/** Minimal session surface for probe/sync + test doubles. */
export type ImapSessionLike = {
  command(
    payload: string,
    label?: string,
  ): Promise<{ status: string; text: string; untagged: string[] }>
  readGreeting(): Promise<void>
  close(): void
}

export type OpenImapFn = (
  host: string,
  port: number,
  security: ImapSecurity,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
) => Promise<ImapSessionLike>

async function openImapConnection(
  host: string,
  port: number,
  security: ImapSecurity,
  connectTimeoutMs = IMAP_CONNECT_TIMEOUT_MS,
  commandTimeoutMs = IMAP_COMMAND_TIMEOUT_MS,
): Promise<ImapSessionLike> {
  const deadline = Date.now() + Math.max(1, connectTimeoutMs)
  const remaining = () => Math.max(1, deadline - Date.now())

  try {
    if (security === 'tls') {
      const conn = await withImapTimeout(
        Deno.connectTls({ hostname: host, port }),
        remaining(),
        'IMAP connect',
      )
      const session = new ImapSession(conn, commandTimeoutMs)
      await withImapTimeout(session.readGreeting(), remaining(), 'IMAP greeting')
      return session
    }

    const plain = await withImapTimeout(
      Deno.connect({ hostname: host, port }),
      remaining(),
      'IMAP connect',
    )
    const session = new ImapSession(plain, commandTimeoutMs)
    await withImapTimeout(session.readGreeting(), remaining(), 'IMAP greeting')

    if (security === 'none') return session

    const started = await session.command('STARTTLS')
    if (started.status !== 'OK') {
      session.close()
      throw new ImapSyncError('imap_tls_failed', `STARTTLS failed: ${started.text}`)
    }

    // Upgrade the same TCP connection. Do not close `session` first (would close plain).
    const tlsConn = await withImapTimeout(
      Deno.startTls(plain, { hostname: host }),
      remaining(),
      'IMAP STARTTLS upgrade',
    )
    return new ImapSession(tlsConn, commandTimeoutMs)
  } catch (error) {
    if (error instanceof ImapSyncError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ImapSyncError('timeout', 'IMAP connect timed out')
    }
    const message = error instanceof Error ? error.message : 'connection failed'
    if (/timed?\s*out|aborted|abort/i.test(message)) {
      throw new ImapSyncError('timeout', message)
    }
    const code = /tls|certificate|ssl/i.test(message) ? 'imap_tls_failed' : 'imap_connection_failed'
    throw new ImapSyncError(code, message)
  }
}

let openImapConnectionImpl: OpenImapFn = openImapConnection

/** Test seam — pass null to restore the real opener. */
export function setOpenImapConnectionForTests(fn: OpenImapFn | null): void {
  openImapConnectionImpl = fn ?? openImapConnection
}

function extractUidList(untagged: string[]): number[] {
  const uids: number[] = []
  for (const line of untagged) {
    const m = line.match(/^\* SEARCH(?:\s+(.+))?$/i)
    if (!m?.[1]?.trim()) continue
    for (const tok of m[1].trim().split(/\s+/)) {
      const n = Number(tok)
      if (Number.isFinite(n) && n > 0) uids.push(n)
    }
  }
  return uids
}

/** Extract literal body after `BODY[...] {n}\\n`. */
export function extractBodyLiteral(block: string, sectionPrefix: string): string | null {
  const idx = block.toUpperCase().indexOf(`BODY[${sectionPrefix.toUpperCase()}`)
  if (idx < 0) return null
  const from = block.slice(idx)
  const lit = from.match(/^BODY\[[^\]]*\](?:<[^>]+>)?\s*\{(\d+)\}\n/i)
  if (!lit || lit.index === undefined) return null
  const size = Number(lit[1])
  const start = lit.index + lit[0].length
  return from.slice(start, start + size)
}

function extractUid(block: string): number | null {
  const m = block.match(/\bUID (\d+)\b/i)
  return m ? Number(m[1]) : null
}

function extractInternalDate(block: string): string | null {
  const m = block.match(/INTERNALDATE "([^"]+)"/i)
  return m?.[1] ?? null
}

function parseInternalDate(raw: string | null): string {
  if (!raw) return new Date().toISOString()
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

function splitFetchBlocks(untagged: string[]): string[] {
  const combined = untagged.join('\n')
  const parts = combined.split(/(?=^\* \d+ FETCH )/m).filter((p) => /^\* \d+ FETCH /i.test(p))
  return parts
}

/**
 * Live IMAP probe: connect + LOGIN + LOGOUT.
 * Throws ImapSyncError (`timeout` / `imap_auth_failed` / `imap_connection_failed` / `imap_tls_failed`).
 */
export async function probeImap(options: ImapProbeOptions): Promise<void> {
  const connectTimeoutMs = options.connectTimeoutMs ?? IMAP_CONNECT_TIMEOUT_MS
  const commandTimeoutMs = options.commandTimeoutMs ?? IMAP_COMMAND_TIMEOUT_MS
  const overallTimeoutMs = options.overallTimeoutMs ?? IMAP_PROBE_TIMEOUT_MS

  await withImapTimeout(
    (async () => {
      const session = await openImapConnectionImpl(
        options.host,
        options.port,
        options.security,
        connectTimeoutMs,
        commandTimeoutMs,
      )
      try {
        const login = await session.command(
          `LOGIN ${quoteImapString(options.username)} ${quoteImapString(options.password)}`,
        )
        if (login.status !== 'OK') {
          throw new ImapSyncError('imap_auth_failed', `IMAP LOGIN failed: ${login.text}`, true)
        }
        await session.command('LOGOUT').catch(() => undefined)
      } finally {
        session.close()
      }
    })(),
    overallTimeoutMs,
    'IMAP probe',
  )
}

export async function fetchInboundFromImap(
  options: ImapFetchOptions,
): Promise<InboundImapMessage[]> {
  const connectTimeoutMs = options.connectTimeoutMs ?? IMAP_CONNECT_TIMEOUT_MS
  const commandTimeoutMs = options.commandTimeoutMs ?? IMAP_COMMAND_TIMEOUT_MS
  const overallTimeoutMs = options.overallTimeoutMs ?? IMAP_SYNC_OVERALL_TIMEOUT_MS

  return await withImapTimeout(
    fetchInboundFromImapInner(options, connectTimeoutMs, commandTimeoutMs),
    overallTimeoutMs,
    'IMAP sync',
  )
}

function parseFetchBlockToMessage(
  block: string,
  maxBodyBytes: number,
): InboundImapMessage | null {
  const uid = extractUid(block)
  if (!uid) return null
  const headerRaw = extractBodyLiteral(block, 'HEADER.FIELDS') ?? ''
  const bodyRaw = extractBodyLiteral(block, 'TEXT') ?? ''
  const headers = parseHeaderBlock(headerRaw)
  const from = parseAddressList(headers['from'])[0] ?? {
    email: 'unknown@invalid',
    name: null,
  }
  const to = parseAddressList(headers['to'])
  const messageId = headers['message-id']?.trim()
  const inReplyTo = headers['in-reply-to']?.trim()
  const references = headers['references']?.trim()?.split(/\s+/).filter(Boolean) ?? []
  const providerMessageId = (messageId && messageId.length > 0 ? messageId : `imap-uid-${uid}`)
    .slice(0, 500)
  const providerThreadId = (inReplyTo || references[0] || providerMessageId).slice(0, 500)
  const truncated = bodyRaw.length >= maxBodyBytes
  const bodyText = bodyRaw.slice(0, maxBodyBytes)
  return {
    provider_message_id: providerMessageId,
    provider_thread_id: providerThreadId,
    from_address: from.email,
    from_name: from.name,
    to_addresses: to,
    subject: (headers['subject'] ?? '').slice(0, 998),
    body_text: bodyText,
    preview_text: bodyText.replace(/\s+/g, ' ').trim().slice(0, 160),
    received_at: parseInternalDate(extractInternalDate(block)),
    body_truncated: truncated,
  }
}

async function fetchInboundFromImapInner(
  options: ImapFetchOptions,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
): Promise<InboundImapMessage[]> {
  const session = await openImapConnectionImpl(
    options.host,
    options.port,
    options.security,
    connectTimeoutMs,
    commandTimeoutMs,
  )
  try {
    const login = await session.command(
      `LOGIN ${quoteImapString(options.username)} ${quoteImapString(options.password)}`,
    )
    if (login.status !== 'OK') {
      throw new ImapSyncError('imap_auth_failed', `IMAP LOGIN failed: ${login.text}`, true, 'login')
    }

    const selected = await session.command('SELECT INBOX', 'IMAP SELECT')
    if (selected.status !== 'OK') {
      throw new ImapSyncError(
        'imap_select_failed',
        `SELECT INBOX failed: ${selected.text}`,
        false,
        'select',
      )
    }

    const since = formatImapSinceDate(options.lookbackDays)
    const search = await session.command(`UID SEARCH SINCE ${since}`, 'IMAP SEARCH')
    if (search.status !== 'OK') {
      throw new ImapSyncError(
        'imap_search_failed',
        `UID SEARCH failed: ${search.text}`,
        false,
        'search',
      )
    }

    let uids = extractUidList(search.untagged)
    if (uids.length === 0) return []
    uids = uids.slice(-Math.max(1, options.maxMessages))

    const headerSection = 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)'
    const fetchSpec = `UID INTERNALDATE BODY.PEEK[${headerSection}] BODY.PEEK[TEXT]<0.${
      Math.max(1, options.maxBodyBytes)
    }>`

    const messages: InboundImapMessage[] = []
    for (const batch of chunkUids(uids, IMAP_FETCH_BATCH_SIZE)) {
      const fetch = await session.command(
        `UID FETCH ${batch.join(',')} (${fetchSpec})`,
        'IMAP FETCH',
      )
      if (fetch.status !== 'OK') {
        throw new ImapSyncError(
          'imap_fetch_failed',
          `UID FETCH failed: ${fetch.text}`,
          false,
          'fetch',
        )
      }
      for (const block of splitFetchBlocks(fetch.untagged)) {
        const message = parseFetchBlockToMessage(block, options.maxBodyBytes)
        if (message) messages.push(message)
      }
    }

    await session.command('LOGOUT').catch(() => undefined)
    return messages
  } finally {
    session.close()
  }
}
