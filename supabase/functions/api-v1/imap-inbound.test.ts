import { assertEquals, assertRejects } from '@std/assert'
import {
  applyFetchedUid,
  assertSafeOutboundHost,
  catchupIsComplete,
  chunkUids,
  decodeMimeBodyText,
  decodeMimeMessage,
  emptyMailboxSyncCursor,
  extractBodyLiteral,
  formatImapSinceDate,
  IMAP_CONNECT_TIMEOUT_MS,
  IMAP_FETCH_BATCH_SIZE,
  type ImapByteConn,
  ImapSyncError,
  isBlockedOutboundHostname,
  isBlockedOutboundIp,
  isSyntheticImapHost,
  parseAddressList,
  parseHeaderBlock,
  parseUidValidity,
  probeImap,
  runImapCommandForTests,
  safeMailboxSyncFailureMessage,
  selectUidsForCycle,
  setOpenImapConnectionForTests,
  withImapTimeout,
} from '../_shared/imap-inbound.ts'

/** Scripted IMAP server bytes for one command (tag A0001). */
function scriptedConn(responseUtf8: string): ImapByteConn {
  const encoder = new TextEncoder()
  const inbound = encoder.encode(responseUtf8)
  let offset = 0
  return {
    read(p: Uint8Array) {
      if (offset >= inbound.length) return Promise.resolve(null)
      const n = Math.min(p.length, inbound.length - offset)
      p.set(inbound.subarray(offset, offset + n))
      offset += n
      return Promise.resolve(n)
    },
    write(p: Uint8Array) {
      return Promise.resolve(p.length)
    },
    close() {},
  }
}

Deno.test('isSyntheticImapHost matches *.example.test only', () => {
  assertEquals(isSyntheticImapHost('imap.example.test'), true)
  assertEquals(isSyntheticImapHost('mail.example.test'), true)
  assertEquals(isSyntheticImapHost('imap.gmail.com'), false)
  assertEquals(isSyntheticImapHost('outlook.office365.com'), false)
})

Deno.test('formatImapSinceDate uses IMAP day-month-year', () => {
  const fixed = new Date(Date.UTC(2026, 7, 3)) // 3 Aug 2026
  assertEquals(formatImapSinceDate(14, fixed), '20-Jul-2026')
  assertEquals(formatImapSinceDate(0, fixed), '03-Aug-2026')
})

Deno.test('parseAddressList handles name and bare email', () => {
  assertEquals(parseAddressList('Ada Lovelace <ada@example.com>'), [
    { email: 'ada@example.com', name: 'Ada Lovelace' },
  ])
  assertEquals(parseAddressList('bob@example.com, "Cara" <cara@example.com>'), [
    { email: 'bob@example.com', name: null },
    { email: 'cara@example.com', name: 'Cara' },
  ])
})

Deno.test('parseHeaderBlock unfolds and lowercases keys', () => {
  const headers = parseHeaderBlock(
    'Subject: Hello\r\n world\r\nFrom: ada@example.com\r\nMessage-ID: <x@y>\r\n',
  )
  assertEquals(headers['subject'], 'Hello world')
  assertEquals(headers['from'], 'ada@example.com')
  assertEquals(headers['message-id'], '<x@y>')
})

Deno.test('extractBodyLiteral reads BODY[TEXT] payload', () => {
  const header = 'From: a@b.com\r\n'
  const block =
    `* 1 FETCH (UID 9 BODY[TEXT]<0.100> {11}\nHello world BODY[HEADER.FIELDS (FROM)] {${header.length}}\n${header})`
  assertEquals(extractBodyLiteral(block, 'TEXT'), 'Hello world')
  assertEquals(extractBodyLiteral(block, 'HEADER.FIELDS'), header)
})

Deno.test('withImapTimeout maps deadline to timeout code (not connection_failed)', async () => {
  const error = await assertRejects(
    () => withImapTimeout(new Promise(() => {}), 20, 'IMAP connect'),
    ImapSyncError,
  )
  assertEquals(error.code, 'timeout')
  assertEquals(error.authFailed, false)
  assertEquals(error.message.includes('timed out'), true)
})

Deno.test('withImapTimeout resolves when work finishes before deadline', async () => {
  const value = await withImapTimeout(
    Promise.resolve(42),
    IMAP_CONNECT_TIMEOUT_MS,
    'fast',
  )
  assertEquals(value, 42)
})

Deno.test('probeImap maps opener hang to timeout (distinct from auth)', async () => {
  setOpenImapConnectionForTests(() => new Promise(() => {}))
  try {
    const error = await assertRejects(
      () =>
        probeImap({
          host: 'imap.gmail.com',
          port: 993,
          security: 'tls',
          username: 'user@example.com',
          password: 'secret',
          overallTimeoutMs: 40,
          connectTimeoutMs: 40,
          commandTimeoutMs: 40,
        }),
      ImapSyncError,
    )
    assertEquals(error.code, 'timeout')
    assertEquals(error.authFailed, false)
  } finally {
    setOpenImapConnectionForTests(null)
  }
})

Deno.test('probeImap maps LOGIN NO to imap_auth_failed', async () => {
  setOpenImapConnectionForTests(() =>
    Promise.resolve({
      command: (payload: string) => {
        if (payload.startsWith('LOGIN ')) {
          return Promise.resolve({
            status: 'NO',
            text: 'NO [AUTHENTICATIONFAILED]',
            untagged: [] as string[],
          })
        }
        return Promise.resolve({
          status: 'OK',
          text: 'OK',
          untagged: [] as string[],
        })
      },
      readGreeting: () => Promise.resolve(),
      close: () => {},
    })
  )
  try {
    const error = await assertRejects(
      () =>
        probeImap({
          host: 'imap.gmail.com',
          port: 993,
          security: 'tls',
          username: 'user@example.com',
          password: 'wrong',
          overallTimeoutMs: 5_000,
        }),
      ImapSyncError,
    )
    assertEquals(error.code, 'imap_auth_failed')
    assertEquals(error.authFailed, true)
  } finally {
    setOpenImapConnectionForTests(null)
  }
})

Deno.test('chunkUids batches into groups of 1–5 (default 5)', () => {
  assertEquals(IMAP_FETCH_BATCH_SIZE, 5)
  assertEquals(chunkUids([10, 11, 12]), [[10, 11, 12]])
  assertEquals(chunkUids([1, 2, 3, 4, 5, 6, 7], 5), [[1, 2, 3, 4, 5], [6, 7]])
  assertEquals(chunkUids([1, 2, 3, 4, 5, 6], 99), [[1, 2, 3, 4, 5], [6]])
  assertEquals(chunkUids([], 5), [])
})

Deno.test('Dovecot-style FETCH literals: no phantom post-literal CRLF', async () => {
  // Wire: {n}CRLF + n octets, then continuation immediately (no extra CRLF after literal).
  const header = 'From: a@b\r\n' // 12 octets
  const text = 'Hello world' // 11 octets
  const response = `* 1 FETCH (UID 9 BODY[HEADER.FIELDS (FROM)] {${header.length}}\r\n` +
    `${header} BODY[TEXT]<0.100> {${text.length}}\r\n` +
    `${text})\r\n` +
    `A0001 OK FETCH completed\r\n`

  const result = await runImapCommandForTests(
    scriptedConn(response),
    'UID FETCH 9 (BODY.PEEK[])',
    'IMAP FETCH',
    2_000,
  )
  assertEquals(result.status, 'OK')

  const combined = result.untagged.join('\n')
  assertEquals(extractBodyLiteral(combined, 'HEADER.FIELDS'), header)
  assertEquals(extractBodyLiteral(combined, 'TEXT'), text)
})

Deno.test('safeMailboxSyncFailureMessage keeps select/search/fetch distinct', () => {
  assertEquals(
    safeMailboxSyncFailureMessage('imap_select_failed').step,
    'select',
  )
  assertEquals(
    safeMailboxSyncFailureMessage('imap_search_failed').step,
    'search',
  )
  assertEquals(
    safeMailboxSyncFailureMessage('imap_fetch_failed').step,
    'fetch',
  )
  assertEquals(safeMailboxSyncFailureMessage('timeout', 'fetch').step, 'fetch')
  assertEquals(
    safeMailboxSyncFailureMessage('timeout', 'fetch').message.includes('fetch'),
    true,
  )
  assertEquals(
    safeMailboxSyncFailureMessage('imap_connection_failed').message.includes(
      'reach',
    ),
    true,
  )
})

Deno.test('withImapTimeout FETCH label sets step fetch', async () => {
  const error = await assertRejects(
    () => withImapTimeout(new Promise(() => {}), 15, 'IMAP FETCH'),
    ImapSyncError,
  )
  assertEquals(error.code, 'timeout')
  assertEquals(error.step, 'fetch')
})

Deno.test('decodeMimeBodyText prefers Outlook multipart QP text/plain', () => {
  const raw = [
    '--_000_CWLP123MB49142F33173CECF9FBCD2CA7CED52CWLP123MB4914GBRP_',
    'Content-Type: text/plain; charset="iso-8859-1"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hello',
    '',
    '--_000_CWLP123MB49142F33173CECF9FBCD2CA7CED52CWLP123MB4914GBRP_',
    'Content-Type: text/html; charset="iso-8859-1"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<html>',
    '<head>',
    '<meta http-equiv=3D"Content-Type" content=3D"text/html; charset=3Diso-8859-=',
    '1">',
    '</head>',
    '<body dir=3D"ltr">',
    '<div>Hello</div>',
    '</body>',
    '</html>',
    '',
    '--_000_CWLP123MB49142F33173CECF9FBCD2CA7CED52CWLP123MB4914GBRP_--',
    '',
  ].join('\r\n')

  assertEquals(decodeMimeBodyText(raw), 'Hello')
})

Deno.test('decodeMimeBodyText leaves non-multipart body unchanged', () => {
  assertEquals(
    decodeMimeBodyText('Just a plain note\nwith two lines'),
    'Just a plain note\nwith two lines',
  )
})

Deno.test('decodeMimeBodyText falls back to HTML when no plain part', () => {
  const raw = [
    '--bound123',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p>Hi=3Dthere</p>',
    '--bound123--',
    '',
  ].join('\r\n')

  assertEquals(decodeMimeBodyText(raw), 'Hi=there')
})

Deno.test('decodeMimeBodyText decodes base64 text/plain part', () => {
  const payload = btoa('Secret base64 hello')
  const raw = [
    '--b64bound',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    payload,
    '--b64bound--',
    '',
  ].join('\r\n')

  assertEquals(decodeMimeBodyText(raw), 'Secret base64 hello')
})

Deno.test('decodeMimeMessage unwraps nested mixed invoice MIME and lists PDF', () => {
  const pdf = btoa('%PDF-fake')
  const raw = [
    '--MIX',
    'Content-Type: multipart/alternative; boundary=ALT',
    '',
    '--ALT',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please find invoice attached',
    '--ALT',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Please find invoice attached</p>',
    '--ALT--',
    '--MIX',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    pdf,
    '--MIX--',
    '',
  ].join('\r\n')

  const decoded = decodeMimeMessage(
    raw,
    'multipart/mixed; boundary=MIX',
  )
  assertEquals(decoded.text, 'Please find invoice attached')
  assertEquals(decoded.html?.includes('Please find invoice attached'), true)
  assertEquals(decoded.attachments[0]?.filename, 'invoice.pdf')
  assertEquals(
    decoded.text.includes('JVBERi') || decoded.text.includes('%PDF'),
    false,
  )
})

Deno.test('decodeMimeMessage inlines small CID images and lists larger ones', () => {
  const tinyPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='
  const raw = [
    '--REL',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Hi <img src="cid:logo@hesis" alt="logo"></p>',
    '--REL',
    'Content-Type: image/png',
    'Content-ID: <logo@hesis>',
    'Content-Disposition: inline; filename="logo.png"',
    'Content-Transfer-Encoding: base64',
    '',
    tinyPng,
    '--REL--',
    '',
  ].join('\r\n')
  const decoded = decodeMimeMessage(raw, 'multipart/related; boundary=REL')
  assertEquals(decoded.html?.includes('data:image/png;base64,'), true)
  assertEquals(decoded.html?.includes('cid:logo@hesis'), false)
  assertEquals(decoded.attachments[0]?.filename, 'logo.png')
  assertEquals(decoded.attachments[0]?.inline, true)
})

Deno.test('truncated mixed MIME still yields HTML/text not leftover base64', () => {
  const raw = [
    '--MIX',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Invoice 12</p>',
    '--MIX',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQKJ',
  ].join('\r\n')
  const decoded = decodeMimeMessage(raw, 'multipart/mixed; boundary=MIX')
  assertEquals(decoded.html?.includes('Invoice 12'), true)
  assertEquals(decoded.text.includes('JVBERi'), false)
  assertEquals(decoded.attachments[0]?.filename, 'invoice.pdf')
})

Deno.test('selectUidsForCycle walks newest first then older history', () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const first = selectUidsForCycle(all, emptyMailboxSyncCursor(1), 3)
  assertEquals(first.mode, 'first')
  assertEquals(first.uids, [8, 9, 10])

  let cursor = emptyMailboxSyncCursor(1)
  for (const uid of first.uids) cursor = applyFetchedUid(cursor, uid, 'first')
  const older = selectUidsForCycle(all, cursor, 3)
  assertEquals(older.mode, 'older')
  assertEquals(older.uids, [5, 6, 7])

  cursor = {
    uidvalidity: 1,
    highUid: 10,
    lowUid: 1,
    catchupComplete: false,
  }
  assertEquals(catchupIsComplete(all, cursor), true)
  const idle = selectUidsForCycle(all, { ...cursor, catchupComplete: true }, 3)
  assertEquals(idle.mode, 'idle')

  const newer = selectUidsForCycle(
    [...all, 11, 12],
    { ...cursor, catchupComplete: true },
    3,
  )
  assertEquals(newer.mode, 'newer')
  assertEquals(newer.uids, [11, 12])
})

Deno.test('parseUidValidity reads SELECT untagged', () => {
  assertEquals(
    parseUidValidity(['* OK [UIDVALIDITY 17] UIDs valid'], 'OK [READ-WRITE]'),
    17,
  )
})

Deno.test('isBlockedOutboundIp rejects private/link-local/metadata ranges', () => {
  assertEquals(isBlockedOutboundIp('127.0.0.1'), true)
  assertEquals(isBlockedOutboundIp('10.0.0.5'), true)
  assertEquals(isBlockedOutboundIp('172.16.1.1'), true)
  assertEquals(isBlockedOutboundIp('192.168.1.10'), true)
  assertEquals(isBlockedOutboundIp('169.254.169.254'), true)
  assertEquals(isBlockedOutboundIp('100.64.1.1'), true)
  assertEquals(isBlockedOutboundIp('::1'), true)
  assertEquals(isBlockedOutboundIp('fc00::1'), true)
  assertEquals(isBlockedOutboundIp('fe80::1'), true)
  assertEquals(isBlockedOutboundIp('::ffff:127.0.0.1'), true)
  assertEquals(isBlockedOutboundIp('8.8.8.8'), false)
  assertEquals(isBlockedOutboundIp('1.1.1.1'), false)
})

Deno.test('isBlockedOutboundHostname rejects internal names', () => {
  assertEquals(isBlockedOutboundHostname('localhost'), true)
  assertEquals(isBlockedOutboundHostname('mail.internal'), true)
  assertEquals(isBlockedOutboundHostname('host.docker.internal'), true)
  assertEquals(isBlockedOutboundHostname('metadata.google.internal'), true)
  assertEquals(isBlockedOutboundHostname('192.168.0.1'), true)
  assertEquals(isBlockedOutboundHostname('imap.gmail.com'), false)
  assertEquals(isBlockedOutboundHostname('outlook.office365.com'), false)
})

Deno.test('assertSafeOutboundHost blocks literal private IPs', async () => {
  const error = await assertRejects(
    () => assertSafeOutboundHost('169.254.169.254'),
    ImapSyncError,
  )
  assertEquals(error.code, 'imap_host_blocked')
})

Deno.test('assertSafeOutboundHost blocks DNS that resolves to private IPs', async () => {
  const error = await assertRejects(
    () =>
      assertSafeOutboundHost('evil.example.com', (_host, type) => {
        if (type === 'A') return Promise.resolve(['10.1.2.3'])
        return Promise.resolve([])
      }),
    ImapSyncError,
  )
  assertEquals(error.code, 'imap_host_blocked')
})

Deno.test('assertSafeOutboundHost allows public A records and pins the address', async () => {
  const target = await assertSafeOutboundHost(
    'imap.gmail.com',
    (_host, type) => {
      if (type === 'A') return Promise.resolve(['142.250.1.108'])
      return Promise.resolve([])
    },
  )
  assertEquals(target.hostname, 'imap.gmail.com')
  assertEquals(target.connectHost, '142.250.1.108')
})

Deno.test('assertSafeOutboundHost allows synthetic example.test hosts', async () => {
  const target = await assertSafeOutboundHost('imap.example.test')
  assertEquals(target.connectHost, 'imap.example.test')
})
