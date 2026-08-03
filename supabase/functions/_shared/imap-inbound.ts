/**
 * Bounded IMAP inbound fetch for mailbox sync.
 * Supports tls / starttls / none. Body truncated to maxBodyBytes; attachments not fetched.
 */

export type ImapSecurity = 'tls' | 'starttls' | 'none'

export type ImapFetchOptions = {
  host: string
  port: number
  security: ImapSecurity
  username: string
  password: string
  lookbackDays: number
  maxMessages: number
  maxBodyBytes: number
}

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

  constructor(code: string, message: string, authFailed = false) {
    super(message)
    this.name = 'ImapSyncError'
    this.code = code
    this.authFailed = authFailed
  }
}

export function isSyntheticImapHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === 'imap.example.test' || h.endsWith('.example.test')
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

type ByteConn = {
  read(p: Uint8Array): Promise<number | null>
  write(p: Uint8Array): Promise<number>
  close(): void
}

class ImapSession {
  private conn: ByteConn
  private buffer = new Uint8Array(0)
  private tagSeq = 0
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()

  constructor(conn: ByteConn) {
    this.conn = conn
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

  async command(payload: string): Promise<{ status: string; text: string; untagged: string[] }> {
    const tag = `A${String(++this.tagSeq).padStart(4, '0')}`
    await this.conn.write(this.encoder.encode(`${tag} ${payload}\r\n`))

    const untagged: string[] = []
    while (true) {
      let line = this.decoder.decode(await this.readLineBytes())

      const literalMatch = line.match(/\{(\d+)\}$/)
      if (literalMatch) {
        const size = Number(literalMatch[1])
        const literal = await this.readExact(size)
        // Consume CRLF after literal body (IMAP wire format)
        await this.readExact(2)
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

async function openImapConnection(
  host: string,
  port: number,
  security: ImapSecurity,
): Promise<ImapSession> {
  try {
    if (security === 'tls') {
      const conn = await Deno.connectTls({ hostname: host, port })
      const session = new ImapSession(conn)
      await session.readGreeting()
      return session
    }

    const plain = await Deno.connect({ hostname: host, port })
    const session = new ImapSession(plain)
    await session.readGreeting()

    if (security === 'none') return session

    const started = await session.command('STARTTLS')
    if (started.status !== 'OK') {
      session.close()
      throw new ImapSyncError('imap_tls_failed', `STARTTLS failed: ${started.text}`)
    }

    // Upgrade the same TCP connection. Do not close `session` first (would close plain).
    const tlsConn = await Deno.startTls(plain, { hostname: host })
    return new ImapSession(tlsConn)
  } catch (error) {
    if (error instanceof ImapSyncError) throw error
    const message = error instanceof Error ? error.message : 'connection failed'
    const code = /tls|certificate|ssl/i.test(message) ? 'imap_tls_failed' : 'imap_connection_failed'
    throw new ImapSyncError(code, message)
  }
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

export async function fetchInboundFromImap(
  options: ImapFetchOptions,
): Promise<InboundImapMessage[]> {
  const session = await openImapConnection(options.host, options.port, options.security)
  try {
    const login = await session.command(
      `LOGIN ${quoteImapString(options.username)} ${quoteImapString(options.password)}`,
    )
    if (login.status !== 'OK') {
      throw new ImapSyncError('imap_auth_failed', `IMAP LOGIN failed: ${login.text}`, true)
    }

    const selected = await session.command('SELECT INBOX')
    if (selected.status !== 'OK') {
      throw new ImapSyncError('imap_connection_failed', `SELECT INBOX failed: ${selected.text}`)
    }

    const since = formatImapSinceDate(options.lookbackDays)
    const search = await session.command(`UID SEARCH SINCE ${since}`)
    if (search.status !== 'OK') {
      throw new ImapSyncError('imap_connection_failed', `UID SEARCH failed: ${search.text}`)
    }

    let uids = extractUidList(search.untagged)
    if (uids.length === 0) return []
    uids = uids.slice(-Math.max(1, options.maxMessages))

    const headerSection = 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)'
    const fetchSpec = `UID INTERNALDATE BODY.PEEK[${headerSection}] BODY.PEEK[TEXT]<0.${
      Math.max(1, options.maxBodyBytes)
    }>`
    const fetch = await session.command(`UID FETCH ${uids.join(',')} (${fetchSpec})`)
    if (fetch.status !== 'OK') {
      throw new ImapSyncError('imap_connection_failed', `UID FETCH failed: ${fetch.text}`)
    }

    const messages: InboundImapMessage[] = []
    for (const block of splitFetchBlocks(fetch.untagged)) {
      const uid = extractUid(block)
      if (!uid) continue
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
      const truncated = bodyRaw.length >= options.maxBodyBytes
      const bodyText = bodyRaw.slice(0, options.maxBodyBytes)
      messages.push({
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
      })
    }

    await session.command('LOGOUT').catch(() => undefined)
    return messages
  } finally {
    session.close()
  }
}
