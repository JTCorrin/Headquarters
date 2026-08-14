import type { SupabaseClient } from '@supabase/supabase-js'
import type { SmtpSecurity } from './smtp-outbound.ts'

export type OrgInvoiceEmailCredentialRow = {
  id: string
  from_address: string
  from_name: string | null
  reply_to: string | null
  smtp_host: string
  smtp_port: number
  smtp_security: SmtpSecurity
  username: string
  password: string | null
  status: 'pending' | 'active' | 'error' | 'disabled'
  subject_template: string
  body_template: string
}

function asCredentialRow(raw: unknown): OrgInvoiceEmailCredentialRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const securityRaw = String(row.smtp_security ?? 'tls')
  const smtpSecurity: SmtpSecurity = securityRaw === 'starttls' || securityRaw === 'none'
    ? securityRaw
    : 'tls'
  const statusRaw = String(row.status ?? 'pending')
  const status = statusRaw === 'active' || statusRaw === 'error' || statusRaw === 'disabled'
    ? statusRaw
    : 'pending'
  return {
    id: String(row.id ?? ''),
    from_address: String(row.from_address ?? ''),
    from_name: typeof row.from_name === 'string' ? row.from_name : null,
    reply_to: typeof row.reply_to === 'string' ? row.reply_to : null,
    smtp_host: String(row.smtp_host ?? ''),
    smtp_port: Number(row.smtp_port ?? 587),
    smtp_security: smtpSecurity,
    username: String(row.username ?? ''),
    password: typeof row.password === 'string' ? row.password : null,
    status,
    subject_template: String(row.subject_template ?? ''),
    body_template: String(row.body_template ?? ''),
  }
}

export async function readOrgInvoiceEmailCredentials(
  service: SupabaseClient,
  orgId: string,
): Promise<OrgInvoiceEmailCredentialRow | null> {
  const { data, error } = await service.rpc('read_org_invoice_email_credentials', {
    p_org_id: orgId,
  })
  if (error) throw error
  return asCredentialRow(data)
}
