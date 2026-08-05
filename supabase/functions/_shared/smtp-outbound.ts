/**
 * Minimal Deno SMTP client for reply-first outbound mail.
 * Reuses IMAP SSRF policy via assertSafeOutboundHost.
 */

import {
  assertSafeOutboundHost,
  isSyntheticImapHost,
  withImapTimeout,
} from './imap-inbound.ts'

export type SmtpSecurity = 'tls' | 'starttls' | 'none'

export class SmtpSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly step: string | null = null,
  ) {
    super(message)
    this.name = 'SmtpSendError'
  }
}

export type SmtpSendOptions = {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
  from: string
  to: string
  subject: string
  bodyText: string
  bodyHtml?: string | null
  inReplyTo?: string | null
  references?: string | null
  messageId: string
  connectTimeoutMs?: number
  commandTimeoutMs?: number
}

export type SmtpSendResult = {
  message_id: string
  synthetic: boolean
}

const SMTP_CONNECT_TIMEOUT_MS = 15_000
const SMTP_COMMAND_TIMEOUT_MS = 30_000

export function isSyntheticSmtpHost(host: string): boolean {
  return isSyntheticImapHost(host)
}

/** Strip leading Re:/RE:/re: runs, then prefix a single Re:. */
export function replySubject(subject: string | null | undefined): string {
  const raw = (subject ?? '').trim()
  const stripped = raw.replace(/^(re:\s*)+/i, '').trim()
  const base = stripped.length > 0 ? stripped : '(no subject)'
  return `Re: ${base}`
}

/** Ensure Message-ID is angle-bracketed for SMTP headers. */
export function formatMessageIdHeader(id: string): string {
  const t = id.trim()
  if (!t) return t
  if (t.startsWith('<') && t.endsWith('>')) return t
  return `<${t}>`
}

export function generateOutboundMessageId(mailboxEmail: string): string {
  const domain = mailboxEmail.includes('@')
    ? mailboxEmail.split('@').pop()!.toLowerCase()
    : 'localhost'
  const uuid = crypto.randomUUID()
  return `<crm-outbound-${uuid}@${domain}>`
}

function encodeBase64(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
}

function encodeHeaderUtf8(value: string): string {
  // ASCII-safe path: leave alone when no high bytes.
  if (/^[\x20-\x7E]*$/.test(value)) return value
  const b64 = encodeBase64(value)
  return `=?UTF-8?B?${b64}?=`
}

export function buildMimeMessage(options: {
  from: string
  to: string
  subject: string
  bodyText: string
  bodyHtml?: string | null
  messageId: string
  inReplyTo?: string | null
  references?: string | null
  date?: Date
}): string {
  const date = (options.date ?? new Date()).toUTCString()
  const messageId = formatMessageIdHeader(options.messageId)
  const lines: string[] = [
    `From: ${options.from}`,
    `To: ${options.to}`,
    `Subject: ${encodeHeaderUtf8(options.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ]
  const inReplyTo = options.inReplyTo?.trim()
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${formatMessageIdHeader(inReplyTo)}`)
  }
  const references = options.references?.trim() || inReplyTo
  if (references) {
    lines.push(`References: ${formatMessageIdHeader(references)}`)
  }

  const text = options.bodyText ?? ''
  const html = options.bodyHtml?.trim()
  if (html) {
    const boundary = `crm-bound-${crypto.randomUUID()}`
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '')
    lines.push(`--${boundary}`)
    lines.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '')
    lines.push(text.replace(/\r?\n/g, '\r\n'))
    lines.push(`--${boundary}`)
    lines.push('Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '')
    lines.push(html.replace(/\r?\n/g, '\r\n'))
    lines.push(`--${boundary}--`)
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '')
    lines.push(text.replace(/\r?\n/g, '\r\n'))
  }

  // SMTP DATA body must end with CRLF before the terminating ".".
  let raw = lines.join('\r\n')
  if (!raw.endsWith('\r\n')) raw += '\r\n'
  return raw
}

type SmtpConn = Deno.TcpConn | Deno.TlsConn

class SmtpSession {
  private buffer = new Uint8Array(0)
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()

  constructor(
    private conn: SmtpConn,
    private readonly commandTimeoutMs: number,
  ) {}

  close(): void {
    try {
      this.conn.close()
    } catch {
      // ignore
    }
  }

  private async readMore(): Promise<boolean> {
    const chunk = new Uint8Array(8192)
    const n = await this.conn.read(chunk)
    if (n === null || n === 0) return false
    const next = new Uint8Array(this.buffer.length + n)
    next.set(this.buffer)
    next.set(chunk.subarray(0, n), this.buffer.length)
    this.buffer = next
    return true
  }

  /** Read a full SMTP multi-line reply (ends when line is `NNN ` not `NNN-`). */
  async readReply(label = 'SMTP'): Promise<{ code: number; text: string }> {
    return await withImapTimeout(this.readReplyInner(), this.commandTimeoutMs, label)
  }

  private async readReplyInner(): Promise<{ code: number; text: string }> {
    const lines: string[] = []
    for (;;) {
      const nl = this.buffer.indexOf(0x0a)
      if (nl < 0) {
        const ok = await this.readMore()
        if (!ok) {
          throw new SmtpSendError('smtp_connection_failed', 'SMTP connection closed', 'read')
        }
        continue
      }
      let lineBytes = this.buffer.subarray(0, nl)
      this.buffer = this.buffer.subarray(nl + 1)
      if (lineBytes.length > 0 && lineBytes[lineBytes.length - 1] === 0x0d) {
        lineBytes = lineBytes.subarray(0, lineBytes.length - 1)
      }
      const line = this.decoder.decode(lineBytes)
      lines.push(line)
      const m = line.match(/^(\d{3})([ -])/)
      if (!m) continue
      if (m[2] === ' ') {
        const code = Number(m[1])
        return { code, text: lines.join('\n') }
      }
    }
  }

  async expect(okCodes: number[], label: string): Promise<string> {
    const reply = await this.readReply(label)
    if (!okCodes.includes(reply.code)) {
      throw new SmtpSendError(
        'smtp_protocol_error',
        `${label} failed: ${reply.text}`,
        label,
      )
    }
    return reply.text
  }

  async writeLine(line: string): Promise<void> {
    const payload = this.encoder.encode(`${line}\r\n`)
    await withImapTimeout(this.conn.write(payload), this.commandTimeoutMs, 'SMTP write')
  }

  async writeRaw(data: string): Promise<void> {
    // Dot-stuff lines that begin with '.'
    const stuffed = data.replace(/^\./gm, '..')
    const payload = this.encoder.encode(stuffed)
    await withImapTimeout(this.conn.write(payload), this.commandTimeoutMs, 'SMTP DATA write')
  }
}

export type OpenSmtpFn = (
  host: string,
  port: number,
  security: SmtpSecurity,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
) => Promise<SmtpSession>

async function openSmtpConnection(
  host: string,
  port: number,
  security: SmtpSecurity,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
): Promise<SmtpSession> {
  const deadline = Date.now() + Math.max(1, connectTimeoutMs)
  const remaining = () => Math.max(1, deadline - Date.now())

  await assertSafeOutboundHost(host)

  try {
    if (security === 'tls') {
      const conn = await withImapTimeout(
        Deno.connectTls({ hostname: host, port }),
        remaining(),
        'SMTP connect',
      )
      const session = new SmtpSession(conn, commandTimeoutMs)
      await session.expect([220], 'SMTP greeting')
      return session
    }

    const plain = await withImapTimeout(
      Deno.connect({ hostname: host, port }),
      remaining(),
      'SMTP connect',
    )
    const session = new SmtpSession(plain, commandTimeoutMs)
    await session.expect([220], 'SMTP greeting')

    if (security === 'none') return session

    await session.writeLine(`EHLO crm.local`)
    await session.expect([250], 'SMTP EHLO')
    await session.writeLine('STARTTLS')
    await session.expect([220], 'SMTP STARTTLS')

    const tlsConn = await withImapTimeout(
      Deno.startTls(plain, { hostname: host }),
      remaining(),
      'SMTP STARTTLS upgrade',
    )
    return new SmtpSession(tlsConn, commandTimeoutMs)
  } catch (error) {
    if (error instanceof SmtpSendError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SmtpSendError('timeout', 'SMTP connect timed out', 'connect')
    }
    const message = error instanceof Error ? error.message : 'connection failed'
    if (/timed?\s*out|aborted|abort/i.test(message)) {
      throw new SmtpSendError('timeout', message, 'connect')
    }
    const code = /tls|certificate|ssl/i.test(message) ? 'smtp_tls_failed' : 'smtp_connection_failed'
    throw new SmtpSendError(code, message, 'connect')
  }
}

let openSmtpConnectionImpl: OpenSmtpFn = openSmtpConnection

/** Test seam — pass null to restore the real opener. */
export function setOpenSmtpConnectionForTests(fn: OpenSmtpFn | null): void {
  openSmtpConnectionImpl = fn ?? openSmtpConnection
}

async function smtpAuthLogin(session: SmtpSession, username: string, password: string): Promise<void> {
  await session.writeLine('AUTH LOGIN')
  await session.expect([334], 'SMTP AUTH LOGIN')
  await session.writeLine(encodeBase64(username))
  await session.expect([334], 'SMTP AUTH username')
  await session.writeLine(encodeBase64(password))
  await session.expect([235], 'SMTP AUTH password')
}

/**
 * Deliver one message via SMTP. Synthetic `*.example.test` hosts short-circuit
 * without opening a socket (staging/Deno proofs).
 */
export async function sendSmtpMail(options: SmtpSendOptions): Promise<SmtpSendResult> {
  const host = options.host.trim()
  if (!host) {
    throw new SmtpSendError('smtp_host_missing', 'SMTP host is empty', 'connect')
  }

  if (isSyntheticSmtpHost(host)) {
    return { message_id: options.messageId, synthetic: true }
  }

  const connectTimeoutMs = options.connectTimeoutMs ?? SMTP_CONNECT_TIMEOUT_MS
  const commandTimeoutMs = options.commandTimeoutMs ?? SMTP_COMMAND_TIMEOUT_MS
  const session = await openSmtpConnectionImpl(
    host,
    options.port,
    options.security,
    connectTimeoutMs,
    commandTimeoutMs,
  )

  try {
    await session.writeLine('EHLO crm.local')
    await session.expect([250], 'SMTP EHLO')
    await smtpAuthLogin(session, options.username, options.password)

    await session.writeLine(`MAIL FROM:<${options.from}>`)
    await session.expect([250], 'SMTP MAIL FROM')
    await session.writeLine(`RCPT TO:<${options.to}>`)
    await session.expect([250, 251], 'SMTP RCPT TO')
    await session.writeLine('DATA')
    await session.expect([354], 'SMTP DATA')

    const mime = buildMimeMessage({
      from: options.from,
      to: options.to,
      subject: options.subject,
      bodyText: options.bodyText,
      bodyHtml: options.bodyHtml,
      messageId: options.messageId,
      inReplyTo: options.inReplyTo,
      references: options.references,
    })
    await session.writeRaw(mime)
    await session.writeLine('.')
    await session.expect([250], 'SMTP DATA end')
    await session.writeLine('QUIT')
    try {
      await session.readReply('SMTP QUIT')
    } catch {
      // servers often close after QUIT
    }
    return { message_id: options.messageId, synthetic: false }
  } catch (error) {
    if (error instanceof SmtpSendError) throw error
    const message = error instanceof Error ? error.message : 'smtp send failed'
    throw new SmtpSendError('smtp_send_failed', message, 'send')
  } finally {
    session.close()
  }
}
