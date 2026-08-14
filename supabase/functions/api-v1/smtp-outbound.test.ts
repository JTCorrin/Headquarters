import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import {
  buildMimeMessage,
  formatMessageIdHeader,
  generateOutboundMessageId,
  isSyntheticSmtpHost,
  replySubject,
  sendSmtpMail,
  setOpenSmtpConnectionForTests,
  SmtpSendError,
} from '../_shared/smtp-outbound.ts'
import { emailReplyIdempotencyPayload, validateReplyBody } from './email-messages.ts'
import { ApiError } from './http.ts'
import { hashIdempotencyRequest } from './idempotency.ts'

Deno.test('replySubject strips existing Re: prefix once', () => {
  assertEquals(replySubject('Hello'), 'Re: Hello')
  assertEquals(replySubject('Re: Hello'), 'Re: Hello')
  assertEquals(replySubject('RE: re: Hello'), 'Re: Hello')
  assertEquals(replySubject(''), 'Re: (no subject)')
  assertEquals(replySubject(null), 'Re: (no subject)')
})

Deno.test('formatMessageIdHeader and generateOutboundMessageId', () => {
  assertEquals(formatMessageIdHeader('abc@x.test'), '<abc@x.test>')
  assertEquals(formatMessageIdHeader('<abc@x.test>'), '<abc@x.test>')
  const id = generateOutboundMessageId('me@mail.example.test')
  assertEquals(id.startsWith('<crm-outbound-'), true)
  assertEquals(id.endsWith('@mail.example.test>'), true)
})

Deno.test('isSyntheticSmtpHost matches *.example.test', () => {
  assertEquals(isSyntheticSmtpHost('smtp.example.test'), true)
  assertEquals(isSyntheticSmtpHost('mail.example.test'), true)
  assertEquals(isSyntheticSmtpHost('smtp.mailcow.example.com'), false)
})

Deno.test('buildMimeMessage includes reply headers and plain body', () => {
  const mime = buildMimeMessage({
    from: 'me@example.test',
    to: 'peer@example.test',
    subject: 'Re: Hello',
    bodyText: 'Hi there\nLine 2',
    messageId: '<crm-outbound-1@example.test>',
    inReplyTo: 'parent@example.test',
    date: new Date('2026-08-05T12:00:00Z'),
  })
  assertEquals(mime.includes('In-Reply-To: <parent@example.test>'), true)
  assertEquals(mime.includes('References: <parent@example.test>'), true)
  assertEquals(mime.includes('Subject: Re: Hello'), true)
  assertEquals(mime.includes('Hi there\r\nLine 2'), true)
})

Deno.test('validateReplyBody requires body_text and rejects extras', () => {
  assertEquals(validateReplyBody({ body_text: 'hi', body_html: null }), {
    body_text: 'hi',
    body_html: null,
  })
  assertThrows(() => validateReplyBody({ body_text: '  ' }), ApiError)
  assertThrows(
    () => validateReplyBody({ body_text: 'hi', cc: [] }),
    ApiError,
  )
})

Deno.test('email reply idempotency hash is stable for same payload', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const body = { body_text: 'thanks', body_html: null }
  const route = `/api/v1/email-messages/${id}/reply`
  const a = await hashIdempotencyRequest(route, emailReplyIdempotencyPayload(id, body))
  const b = await hashIdempotencyRequest(route, emailReplyIdempotencyPayload(id, body))
  assertEquals(a, b)
  const c = await hashIdempotencyRequest(
    route,
    emailReplyIdempotencyPayload(id, { body_text: 'other', body_html: null }),
  )
  assertEquals(a === c, false)
})

Deno.test('sendSmtpMail short-circuits synthetic hosts without opening sockets', async () => {
  setOpenSmtpConnectionForTests(() => {
    throw new Error('should not open SMTP for synthetic host')
  })
  try {
    const result = await sendSmtpMail({
      host: 'smtp.example.test',
      port: 587,
      security: 'starttls',
      username: 'me@example.test',
      password: 'secret',
      from: 'me@example.test',
      to: 'peer@example.test',
      subject: 'Re: Hi',
      bodyText: 'hello',
      messageId: '<crm-outbound-synth@example.test>',
    })
    assertEquals(result.synthetic, true)
    assertEquals(result.message_id, '<crm-outbound-synth@example.test>')
  } finally {
    setOpenSmtpConnectionForTests(null)
  }
})

Deno.test('buildMimeMessage attaches PDF as multipart/mixed base64', () => {
  const pdf = new TextEncoder().encode('%PDF-1.4 test')
  const mime = buildMimeMessage({
    from: 'billing@example.test',
    to: 'client@example.test',
    subject: 'Invoice INV-1',
    bodyText: 'Please see attached.',
    messageId: '<crm-outbound-inv@example.test>',
    date: new Date('2026-08-14T12:00:00Z'),
    attachments: [
      {
        filename: 'invoice-INV-1.pdf',
        contentType: 'application/pdf',
        bytes: pdf,
      },
    ],
  })
  assertEquals(mime.includes('multipart/mixed'), true)
  assertEquals(mime.includes('Content-Disposition: attachment; filename="invoice-INV-1.pdf"'), true)
  assertEquals(mime.includes('Content-Transfer-Encoding: base64'), true)
  assertEquals(mime.includes('Please see attached.'), true)
})

Deno.test('sendSmtpMail with attachment still short-circuits synthetic hosts', async () => {
  setOpenSmtpConnectionForTests(() => {
    throw new Error('should not open SMTP for synthetic host')
  })
  try {
    const result = await sendSmtpMail({
      host: 'smtp.example.test',
      port: 465,
      security: 'tls',
      username: 'billing@example.test',
      password: 'secret',
      from: 'billing@example.test',
      to: 'client@example.test',
      subject: 'Invoice',
      bodyText: 'attached',
      messageId: '<crm-outbound-attach@example.test>',
      attachments: [
        {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    })
    assertEquals(result.synthetic, true)
  } finally {
    setOpenSmtpConnectionForTests(null)
  }
})

Deno.test('sendSmtpMail rejects empty host', async () => {
  await assertRejects(
    () =>
      sendSmtpMail({
        host: '  ',
        port: 587,
        security: 'tls',
        username: 'u',
        password: 'p',
        from: 'a@b.test',
        to: 'c@d.test',
        subject: 'Re: x',
        bodyText: 'body',
        messageId: '<id@test>',
      }),
    SmtpSendError,
  )
})
