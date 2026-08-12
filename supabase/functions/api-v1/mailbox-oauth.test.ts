import { assertEquals } from 'jsr:@std/assert@1'
import {
  accessTokenNeedsRefresh,
  buildXoauth2SaslString,
  isMailboxOAuthStubMode,
  mailboxPresetHosts,
  parseMailboxTokenBlob,
  serializeMailboxTokenBlob,
} from '../_shared/mailbox-oauth.ts'

Deno.test('buildXoauth2SaslString encodes user and bearer token', () => {
  const sasl = buildXoauth2SaslString('user@example.test', 'tok-123')
  const decoded = new TextDecoder().decode(
    Uint8Array.from(atob(sasl), (c) => c.charCodeAt(0)),
  )
  assertEquals(decoded, 'user=user@example.test\x01auth=Bearer tok-123\x01\x01')
})

Deno.test('parse/serialize mailbox token blob round-trips', () => {
  const blob = {
    refresh_token: 'r',
    access_token: 'a',
    expiry: '2026-08-11T12:00:00.000Z',
    account_email: 'a@b.test',
  }
  const raw = serializeMailboxTokenBlob(blob)
  assertEquals(parseMailboxTokenBlob(raw), blob)
  assertEquals(parseMailboxTokenBlob('opaque-refresh').refresh_token, 'opaque-refresh')
})

Deno.test('accessTokenNeedsRefresh respects expiry skew', () => {
  assertEquals(accessTokenNeedsRefresh({ access_token: 'a' }), false)
  assertEquals(accessTokenNeedsRefresh({}), true)
  assertEquals(
    accessTokenNeedsRefresh({
      access_token: 'a',
      expiry: new Date(Date.now() - 1000).toISOString(),
    }),
    true,
  )
  assertEquals(
    accessTokenNeedsRefresh({
      access_token: 'a',
      expiry: new Date(Date.now() + 10 * 60_000).toISOString(),
    }),
    false,
  )
})

Deno.test('mailboxPresetHosts matches Microsoft and Google docs', () => {
  assertEquals(mailboxPresetHosts('microsoft').smtp_host, 'smtp-mail.outlook.com')
  assertEquals(mailboxPresetHosts('microsoft').imap_host, 'outlook.office365.com')
  assertEquals(mailboxPresetHosts('google').imap_host, 'imap.gmail.com')
})

Deno.test('isMailboxOAuthStubMode reads MAILBOX_OAUTH_STAGING_STUB', () => {
  assertEquals(isMailboxOAuthStubMode(() => '1'), true)
  assertEquals(isMailboxOAuthStubMode(() => 'true'), true)
  assertEquals(isMailboxOAuthStubMode(() => undefined), false)
})
