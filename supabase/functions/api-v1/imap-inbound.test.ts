import { assertEquals } from '@std/assert'
import {
  extractBodyLiteral,
  formatImapSinceDate,
  isSyntheticImapHost,
  parseAddressList,
  parseHeaderBlock,
} from '../_shared/imap-inbound.ts'

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
