import {
  generateOutboundMessageId,
  sendSmtpMail,
  type SmtpAuth,
  type SmtpSecurity,
} from './smtp-outbound.ts'

export type SystemInvitationEmail = {
  to: string
  organisationName: string
  inviterName: string
  role: string
  token: string
  expiresAt: string
}

export type MailboxSmtpSender = {
  mailboxId: string
  host: string
  port: number
  security: SmtpSecurity
  auth: SmtpAuth
  from: string
}

export function resolveAppBaseUrl(req: Request): string {
  const fromEnv = Deno.env.get('APP_BASE_URL')?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  const origin = req.headers.get('origin')?.trim()
  if (origin && /^https?:\/\//i.test(origin)) {
    return origin.replace(/\/+$/, '')
  }
  throw new Error('APP_BASE_URL is not configured')
}

export function parseSmtpSecurity(raw: unknown): SmtpSecurity {
  if (raw === 'tls' || raw === 'starttls' || raw === 'none') return raw
  throw new Error('Mailbox SMTP security is invalid')
}

export function invitationEmailContent(
  input: SystemInvitationEmail,
  appBaseUrl: string,
): {
  subject: string
  bodyText: string
  bodyHtml: string
  acceptUrl: string
} {
  const acceptUrl = `${appBaseUrl.replace(/\/+$/, '')}/invite/accept?token=${
    encodeURIComponent(input.token)
  }`
  const subject = `You're invited to ${input.organisationName}`
  const expiry = new Date(input.expiresAt).toUTCString()
  const bodyText = [
    `${input.inviterName} invited you to join ${input.organisationName} as ${input.role}.`,
    '',
    `Accept the invitation: ${acceptUrl}`,
    '',
    `This one-time invitation expires ${expiry}. Sign in with ${input.to} to accept it.`,
  ].join('\n')
  const bodyHtml = [
    `<p>${escapeHtml(input.inviterName)} invited you to join <strong>${
      escapeHtml(input.organisationName)
    }</strong> as ${escapeHtml(input.role)}.</p>`,
    `<p><a href="${escapeHtml(acceptUrl)}">Accept invitation</a></p>`,
    `<p>This one-time invitation expires ${escapeHtml(expiry)}. Sign in with ${
      escapeHtml(input.to)
    } to accept it.</p>`,
  ].join('')
  return { subject, bodyText, bodyHtml, acceptUrl }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  )
}

/** Send an invitation using the inviter's personal mailbox SMTP (never platform SYSTEM_SMTP). */
export async function sendMailboxInvitationEmail(
  input: SystemInvitationEmail,
  mailbox: MailboxSmtpSender,
  appBaseUrl: string,
): Promise<void> {
  const content = invitationEmailContent(input, appBaseUrl)
  await sendSmtpMail({
    host: mailbox.host,
    port: mailbox.port,
    security: mailbox.security,
    auth: mailbox.auth,
    from: mailbox.from,
    to: input.to,
    subject: content.subject,
    bodyText: content.bodyText,
    bodyHtml: content.bodyHtml,
    messageId: generateOutboundMessageId(mailbox.from),
  })
}
