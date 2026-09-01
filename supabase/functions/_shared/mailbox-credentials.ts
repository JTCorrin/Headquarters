/**
 * Resolve mailbox IMAP/SMTP auth from vault credentials (password or OAuth).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImapAuth } from './imap-inbound.ts'
import {
  ensureMailboxAccessToken,
  type MailboxOAuthProvider,
  parseMailboxTokenBlob,
  serializeMailboxTokenBlob,
} from './mailbox-oauth.ts'
import type { SmtpAuth } from './smtp-outbound.ts'

export type MailboxCredentialRow = {
  auth_mode: 'password' | 'oauth'
  oauth_provider: MailboxOAuthProvider | null
  password: string | null
  token_blob: string | null
  username: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_security: string
  smtp_host: string
  smtp_port: number
  smtp_security: string
}

export type ResolvedMailboxAuth = {
  username: string
  email_address: string
  imapAuth: ImapAuth
  smtpAuth: SmtpAuth
  row: MailboxCredentialRow
}

function asCredentialRow(raw: unknown): MailboxCredentialRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const username = typeof row.username === 'string' ? row.username : ''
  const email = typeof row.email_address === 'string' ? row.email_address : ''
  const authMode = row.auth_mode === 'oauth' ? 'oauth' : 'password'
  const provider = row.oauth_provider === 'microsoft' || row.oauth_provider === 'google'
    ? row.oauth_provider
    : null
  return {
    auth_mode: authMode,
    oauth_provider: provider,
    password: typeof row.password === 'string' ? row.password : null,
    token_blob: typeof row.token_blob === 'string' ? row.token_blob : null,
    username,
    email_address: email,
    imap_host: String(row.imap_host ?? ''),
    imap_port: Number(row.imap_port ?? 993),
    imap_security: String(row.imap_security ?? 'tls'),
    smtp_host: String(row.smtp_host ?? ''),
    smtp_port: Number(row.smtp_port ?? 465),
    smtp_security: String(row.smtp_security ?? 'tls'),
  }
}

export async function readMailboxCredentialRow(
  service: SupabaseClient,
  mailboxId: string,
  orgId?: string,
): Promise<MailboxCredentialRow | null> {
  const { data, error } = await service.rpc('read_mailbox_sync_credentials', {
    p_mailbox_id: mailboxId,
    ...(orgId ? { p_org_id: orgId } : {}),
  })
  if (error) throw error
  return asCredentialRow(data)
}

export async function resolveMailboxAuthFromCredentials(
  service: SupabaseClient,
  mailboxId: string,
  creds: MailboxCredentialRow,
): Promise<ResolvedMailboxAuth | null> {
  const username = (creds.username || creds.email_address).trim()
  if (!username) return null

  if (creds.auth_mode === 'oauth') {
    const provider = creds.oauth_provider
    if (!provider || !creds.token_blob) return null
    const blob = parseMailboxTokenBlob(creds.token_blob)
    const ensured = await ensureMailboxAccessToken(provider, blob)
    if (ensured.refreshed) {
      await service.rpc('update_mailbox_oauth_token_blob', {
        p_mailbox_id: mailboxId,
        p_token_blob: serializeMailboxTokenBlob(ensured.blob),
      })
    }
    const auth: ImapAuth = {
      type: 'xoauth2',
      username,
      accessToken: ensured.accessToken,
    }
    return {
      username,
      email_address: creds.email_address,
      imapAuth: auth,
      smtpAuth: {
        type: 'xoauth2',
        username,
        accessToken: ensured.accessToken,
      },
      row: creds,
    }
  }

  if (!creds.password) return null
  return {
    username,
    email_address: creds.email_address,
    imapAuth: { type: 'password', username, password: creds.password },
    smtpAuth: { type: 'password', username, password: creds.password },
    row: creds,
  }
}

export async function resolveMailboxAuth(
  service: SupabaseClient,
  mailboxId: string,
  orgId?: string,
): Promise<ResolvedMailboxAuth | null> {
  const creds = await readMailboxCredentialRow(service, mailboxId, orgId)
  if (!creds) return null
  return resolveMailboxAuthFromCredentials(service, mailboxId, creds)
}
