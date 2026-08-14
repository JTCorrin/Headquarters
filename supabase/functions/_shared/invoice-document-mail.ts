import type { SupabaseClient } from '@supabase/supabase-js'
import {
  generateOutboundMessageId,
  sendSmtpMail,
  type SmtpSecurity,
  SmtpSendError,
} from './smtp-outbound.ts'
import { readOrgInvoiceEmailCredentials } from './org-invoice-email-credentials.ts'

export class InvoiceDocumentMailError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'InvoiceDocumentMailError'
  }
}

export function renderInvoiceEmailTemplates(
  subjectTemplate: string,
  bodyTemplate: string,
  vars: Record<string, string>,
): { subject: string; body: string } {
  const replace = (template: string) =>
    template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '')
  return {
    subject: replace(subjectTemplate),
    body: replace(bodyTemplate),
  }
}

function formatFromAddress(fromAddress: string, fromName: string | null): string {
  const email = fromAddress.trim()
  const name = fromName?.trim()
  if (!name) return email
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}" <${email}>`
}

function uniqueRecipientAddresses(addresses: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of addresses) {
    const email = raw.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    result.push(email)
  }
  return result
}

export type SendInvoiceDocumentEmailInput = {
  service: SupabaseClient
  orgId: string
  toAddresses: string[]
  invoiceNumber: string
  clientName: string
  totalLabel: string
  dueOn: string
  orgName: string
  pdfBytes: Uint8Array
  pdfFilename: string
}

export async function sendInvoiceDocumentEmail(
  input: SendInvoiceDocumentEmailInput,
): Promise<{ recipients: string[]; message_ids: string[] }> {
  const creds = await readOrgInvoiceEmailCredentials(input.service, input.orgId)
  if (!creds) {
    throw new InvoiceDocumentMailError(
      'credentials_missing',
      'Organisation invoice email is not configured',
    )
  }
  if (creds.status === 'disabled') {
    throw new InvoiceDocumentMailError(
      'credentials_disabled',
      'Organisation invoice email is disabled',
    )
  }
  if (!creds.password) {
    throw new InvoiceDocumentMailError(
      'credentials_missing',
      'Organisation invoice email password is not configured',
    )
  }

  const recipients = uniqueRecipientAddresses(input.toAddresses)
  if (recipients.length < 1) {
    throw new InvoiceDocumentMailError(
      'recipients_missing',
      'No recipient email addresses are available for this invoice',
    )
  }

  const templates = renderInvoiceEmailTemplates(
    creds.subject_template,
    creds.body_template,
    {
      invoice_number: input.invoiceNumber,
      client_name: input.clientName,
      total: input.totalLabel,
      due_on: input.dueOn,
      org_name: input.orgName,
    },
  )

  const from = formatFromAddress(creds.from_address, creds.from_name)
  const security = creds.smtp_security as SmtpSecurity
  const messageIds: string[] = []

  for (const to of recipients) {
    const messageId = generateOutboundMessageId(creds.from_address)
    try {
      await sendSmtpMail({
        host: creds.smtp_host,
        port: creds.smtp_port,
        security,
        auth: { type: 'password', username: creds.username, password: creds.password },
        from,
        to,
        subject: templates.subject,
        bodyText: templates.body,
        messageId,
        attachments: [{
          filename: input.pdfFilename,
          contentType: 'application/pdf',
          bytes: input.pdfBytes,
        }],
      })
      messageIds.push(messageId)
    } catch (error) {
      if (error instanceof SmtpSendError) {
        throw new InvoiceDocumentMailError(error.code, error.message)
      }
      throw error
    }
  }

  return { recipients, message_ids: messageIds }
}
