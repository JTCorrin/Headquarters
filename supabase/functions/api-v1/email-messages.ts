import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import {
  emptyMailboxSyncCursor,
  type ImapFetchOptions,
  type ImapInboxSyncResult,
  type ImapSecurity,
  ImapSyncError,
  type InboundImapMessage,
  isSyntheticImapHost,
  type MailboxSyncCursor,
  runImapInboxSync,
  safeMailboxSyncFailureMessage,
} from '../_shared/imap-inbound.ts'
import { resolveMailboxAuth } from '../_shared/mailbox-credentials.ts'
import {
  generateOutboundMessageId,
  isSyntheticSmtpHost,
  replySubject,
  sendSmtpMail,
  type SmtpSecurity,
  SmtpSendError,
  type SmtpSendOptions,
} from '../_shared/smtp-outbound.ts'
import {
  hashIdempotencyRequest,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyConflictError,
  type IdempotencyEnvelope,
  parseIdempotencyKey,
  sha256Hex,
} from './idempotency.ts'
import { ApiError, jsonBody, jsonResponse, parseUuid } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

type ImapInboxSyncFn = (
  options: ImapFetchOptions,
) => Promise<ImapInboxSyncResult>
type ImapInboundFetcher = (
  options: ImapFetchOptions,
) => Promise<InboundImapMessage[]>
type SmtpMailSender = (
  options: SmtpSendOptions,
) => Promise<{ message_id: string; synthetic: boolean }>

let imapInboxSync: ImapInboxSyncFn = runImapInboxSync
let smtpMailSender: SmtpMailSender = sendSmtpMail

/** Test seam — pass null to restore the real IMAP fetcher. */
export function setImapInboundFetcherForTests(
  fetcher: ImapInboundFetcher | null,
): void {
  if (!fetcher) {
    imapInboxSync = runImapInboxSync
    return
  }
  imapInboxSync = async (options) => {
    const messages = await fetcher(options)
    return {
      messages,
      cursor: options.cursor ?? emptyMailboxSyncCursor(),
      timedOut: false,
      uidvalidity: options.cursor?.uidvalidity ?? 1,
    }
  }
}

/** Test seam — pass null to restore the real SMTP sender. */
export function setSmtpMailSenderForTests(sender: SmtpMailSender | null): void {
  smtpMailSender = sender ?? sendSmtpMail
}

function serviceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Service credentials are unavailable',
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function databaseError(
  error: { code?: string; message?: string },
  requestId: string,
): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Email operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Email resource not found')
  }
  if (error.code === '55006' || message.includes('daily email send limit')) {
    return new ApiError(
      429,
      'RATE_LIMITED',
      'Daily email send limit reached for this mailbox',
    )
  }
  if (
    error.code === '22023' ||
    message.includes('must be inbound') ||
    message.includes('invalid outbound status')
  ) {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      error.message || 'Email reply validation failed',
    )
  }
  const conflict = idempotencyConflictError(error)
  if (conflict) return conflict
  console.error('Email operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The email operation failed')
}

export function validateShareBody(
  body: Record<string, unknown>,
): { entity_type: 'contact' | 'lead' | 'client'; entity_id: string } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'entity_type' && key !== 'entity_id') {
      fields[key] = 'Field is not writable'
    }
  }
  const entityType = typeof body.entity_type === 'string' ? body.entity_type : ''
  if (!['contact', 'lead', 'client'].includes(entityType)) {
    fields.entity_type = 'Must be contact, lead, or client'
  }
  let entityId = ''
  try {
    entityId = parseUuid(
      typeof body.entity_id === 'string' ? body.entity_id : '',
      'entity_id',
    )
  } catch {
    fields.entity_id = 'Must be a UUID'
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Share validation failed',
      fields,
    )
  }
  return {
    entity_type: entityType as 'contact' | 'lead' | 'client',
    entity_id: entityId,
  }
}

export function validateReplyBody(
  body: Record<string, unknown>,
): { body_text: string; body_html: string | null } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'body_text' && key !== 'body_html') {
      fields[key] = 'Field is not writable'
    }
  }
  const bodyText = typeof body.body_text === 'string' ? body.body_text : ''
  if (!bodyText.trim()) {
    fields.body_text = 'Must be a non-empty string'
  } else if (new TextEncoder().encode(bodyText).byteLength > 64_000) {
    fields.body_text = 'Must be at most 64 KiB'
  }
  let bodyHtml: string | null = null
  if (body.body_html !== undefined && body.body_html !== null) {
    if (typeof body.body_html !== 'string') {
      fields.body_html = 'Must be a string or null'
    } else if (new TextEncoder().encode(body.body_html).byteLength > 64_000) {
      fields.body_html = 'Must be at most 64 KiB'
    } else {
      bodyHtml = body.body_html
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Reply validation failed',
      fields,
    )
  }
  return { body_text: bodyText, body_html: bodyHtml }
}

export function emailReplyIdempotencyPayload(
  parentMessageId: string,
  body: { body_text: string; body_html: string | null },
): Record<string, unknown> {
  return {
    parent_message_id: parentMessageId,
    body_text: body.body_text,
    body_html: body.body_html,
  }
}

const COMPOSE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COMPOSE_ENTITY_TYPES = ['contact', 'lead', 'client'] as const
type ComposeEntityType = (typeof COMPOSE_ENTITY_TYPES)[number]

function hasComposeControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function isComposeEmail(value: string): boolean {
  return !hasComposeControlChars(value) &&
    COMPOSE_EMAIL_RE.test(value) && value.length <= 320
}

export function validateComposeBody(
  body: Record<string, unknown>,
): {
  to: string | null
  subject: string
  body_text: string
  body_html: string | null
  allow_external_recipients: boolean
} {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (
      key !== 'to' && key !== 'subject' && key !== 'body_text' &&
      key !== 'body_html' && key !== 'allow_external_recipients'
    ) {
      fields[key] = 'Field is not writable'
    }
  }
  let to: string | null = null
  if (body.to !== undefined && body.to !== null) {
    if (typeof body.to !== 'string') {
      fields.to = 'Must be a valid email address'
    } else {
      const trimmed = body.to.trim()
      if (trimmed) {
        if (!isComposeEmail(trimmed)) {
          fields.to = 'Must be a valid email address'
        } else {
          to = trimmed
        }
      }
    }
  }
  let allowExternalRecipients = false
  if (body.allow_external_recipients !== undefined) {
    if (typeof body.allow_external_recipients !== 'boolean') {
      fields.allow_external_recipients = 'Must be a boolean'
    } else {
      allowExternalRecipients = body.allow_external_recipients
    }
  }
  const subject = typeof body.subject === 'string' ? body.subject : ''
  if (!subject.trim()) {
    fields.subject = 'Must be a non-empty string'
  } else if (new TextEncoder().encode(subject).byteLength > 998) {
    fields.subject = 'Must be at most 998 bytes'
  }
  const bodyText = typeof body.body_text === 'string' ? body.body_text : ''
  if (!bodyText.trim()) {
    fields.body_text = 'Must be a non-empty string'
  } else if (new TextEncoder().encode(bodyText).byteLength > 64_000) {
    fields.body_text = 'Must be at most 64 KiB'
  }
  let bodyHtml: string | null = null
  if (body.body_html !== undefined && body.body_html !== null) {
    if (typeof body.body_html !== 'string') {
      fields.body_html = 'Must be a string or null'
    } else if (new TextEncoder().encode(body.body_html).byteLength > 64_000) {
      fields.body_html = 'Must be at most 64 KiB'
    } else {
      bodyHtml = body.body_html
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Compose validation failed',
      fields,
    )
  }
  return {
    to,
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    allow_external_recipients: allowExternalRecipients,
  }
}

export function emailComposeIdempotencyPayload(
  entityType: ComposeEntityType,
  entityId: string,
  body: {
    to: string
    subject: string
    body_text: string
    body_html: string | null
    allow_external_recipients?: boolean
  },
): Record<string, unknown> {
  return {
    entity_type: entityType,
    entity_id: entityId,
    to: body.to,
    subject: body.subject,
    body_text: body.body_text,
    body_html: body.body_html,
  }
}

function replyEnvelopeResponse(
  envelope: IdempotencyEnvelope,
  requestId: string,
  rawKey: string,
): Response {
  return jsonResponse(
    envelope.response_body ?? { data: null },
    envelope.response_status ?? 200,
    requestId,
    {
      ...(envelope.response_headers ?? {}),
      [IDEMPOTENCY_KEY_HEADER]: rawKey,
    },
  )
}

function parseSmtpSecurity(raw: unknown): SmtpSecurity {
  if (raw === 'starttls' || raw === 'none' || raw === 'tls') return raw
  return 'tls'
}

async function abortReplyClaim(
  db: DatabaseClient,
  orgId: string,
  keyHash: string,
): Promise<void> {
  await db.rpc('abort_email_reply_idempotent', {
    p_org_id: orgId,
    p_idempotency_key_hash: keyHash,
  })
}

async function replyEmailMessage(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  parentMessageId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (role === 'billing' || role === 'readonly') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This membership cannot reply to email messages',
    )
  }

  const rawKey = parseIdempotencyKey(req)
  const route = `/api/v1/email-messages/${parentMessageId}/reply`
  const payload = validateReplyBody(await jsonBody(req))
  const requestHash = await hashIdempotencyRequest(
    route,
    emailReplyIdempotencyPayload(parentMessageId, payload),
  )
  const keyHash = await sha256Hex(rawKey)

  const { data: beginData, error: beginError } = await db.rpc(
    'begin_email_reply_idempotent',
    {
      p_org_id: orgId,
      p_parent_message_id: parentMessageId,
      p_idempotency_key_hash: keyHash,
      p_request_hash: requestHash,
      p_route: route,
    },
  )
  if (beginError) {
    const conflict = idempotencyConflictError(beginError)
    if (conflict) throw conflict
    throw databaseError(beginError, requestId)
  }
  if (!beginData || typeof beginData !== 'object' || Array.isArray(beginData)) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Email reply begin returned an unexpected payload',
    )
  }

  const begin = beginData as Record<string, unknown>
  if (begin.replay === true) {
    return replyEnvelopeResponse(
      begin as IdempotencyEnvelope,
      requestId,
      rawKey,
    )
  }

  const parent = begin.parent as Record<string, unknown> | undefined
  const mailbox = begin.mailbox as Record<string, unknown> | undefined
  if (!parent || !mailbox) {
    await abortReplyClaim(db, orgId, keyHash)
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Email reply begin missing parent/mailbox',
    )
  }

  const mailboxId = String(mailbox.id ?? '')
  const smtpHost = String(mailbox.smtp_host ?? '')
  const smtpPort = Number(mailbox.smtp_port ?? 0)
  const fromAddress = String(mailbox.email_address ?? '')
  const toAddress = String(parent.from_address ?? '')
  const parentProviderId = typeof parent.provider_message_id === 'string'
    ? parent.provider_message_id
    : null
  const subject = replySubject(
    typeof parent.subject === 'string' ? parent.subject : '',
  )

  if (!mailbox.credentials_configured) {
    await abortReplyClaim(db, orgId, keyHash)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Mailbox credentials are not configured',
      {
        mailbox: 'Credentials required to send mail',
      },
    )
  }
  if (
    !smtpHost || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535
  ) {
    await abortReplyClaim(db, orgId, keyHash)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Mailbox SMTP settings are incomplete',
      {
        smtp_host: 'Host and port are required',
      },
    )
  }
  if (!fromAddress || !toAddress) {
    await abortReplyClaim(db, orgId, keyHash)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Reply addresses are incomplete',
      {
        from_address: !fromAddress ? 'Mailbox address required' : 'ok',
        to_address: !toAddress ? 'Parent from_address required' : 'ok',
      },
    )
  }

  const messageId = generateOutboundMessageId(fromAddress)
  let failureCode: string | null = null
  let smtpReached = false

  try {
    const service = serviceRoleClient()
    const resolved = await resolveMailboxAuth(service, mailboxId, orgId)
    if (!resolved) {
      await abortReplyClaim(db, orgId, keyHash)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Mailbox credentials are not configured',
        {
          mailbox: 'Connect your mailbox or save a password to send mail',
        },
      )
    }

    const security = parseSmtpSecurity(
      resolved.row.smtp_security ?? mailbox.smtp_security,
    )
    smtpReached = true
    await smtpMailSender({
      host: smtpHost,
      port: smtpPort,
      security,
      auth: resolved.smtpAuth,
      from: fromAddress,
      to: toAddress,
      subject,
      bodyText: payload.body_text,
      bodyHtml: payload.body_html,
      inReplyTo: parentProviderId,
      references: parentProviderId,
      messageId,
    })
  } catch (error) {
    if (error instanceof ApiError) throw error

    if (error instanceof SmtpSendError) {
      failureCode = error.code
    } else {
      failureCode = 'smtp_send_failed'
    }
    console.error('SMTP reply failed', {
      request_id: requestId,
      code: failureCode,
      synthetic: isSyntheticSmtpHost(smtpHost),
    })

    if (smtpReached) {
      const { data: failData, error: failError } = await db.rpc(
        'finish_email_reply_idempotent',
        {
          p_org_id: orgId,
          p_parent_message_id: parentMessageId,
          p_body_text: payload.body_text,
          p_body_html: payload.body_html,
          p_subject: subject,
          p_provider_message_id: messageId,
          p_status: 'failed',
          p_failure_code: failureCode,
          p_idempotency_key_hash: keyHash,
        },
      )
      if (failError) {
        await abortReplyClaim(db, orgId, keyHash)
        throw databaseError(failError, requestId)
      }
      await abortReplyClaim(db, orgId, keyHash)
      const failEnvelope = failData as IdempotencyEnvelope
      return jsonResponse(
        failEnvelope?.response_body ?? {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Outbound SMTP delivery failed',
            request_id: requestId,
          },
        },
        failEnvelope?.response_status ?? 502,
        requestId,
        { [IDEMPOTENCY_KEY_HEADER]: rawKey },
      )
    }

    await abortReplyClaim(db, orgId, keyHash)
    throw new ApiError(502, 'INTERNAL_ERROR', 'Outbound SMTP delivery failed')
  }

  const { data: finishData, error: finishError } = await db.rpc(
    'finish_email_reply_idempotent',
    {
      p_org_id: orgId,
      p_parent_message_id: parentMessageId,
      p_body_text: payload.body_text,
      p_body_html: payload.body_html,
      p_subject: subject,
      p_provider_message_id: messageId,
      p_status: 'sent',
      p_failure_code: null,
      p_idempotency_key_hash: keyHash,
    },
  )
  if (finishError) {
    await abortReplyClaim(db, orgId, keyHash)
    throw databaseError(finishError, requestId)
  }
  if (
    !finishData || typeof finishData !== 'object' || Array.isArray(finishData)
  ) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Email reply finish returned an unexpected payload',
    )
  }
  return replyEnvelopeResponse(
    finishData as IdempotencyEnvelope,
    requestId,
    rawKey,
  )
}

async function shareEmailMessage(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  messageId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (role === 'billing' || role === 'readonly') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This membership cannot share email messages',
    )
  }
  const payload = validateShareBody(await jsonBody(req))
  const { data, error } = await db.rpc('share_email_message_to_timeline', {
    p_org_id: orgId,
    p_message_id: messageId,
    p_entity_type: payload.entity_type,
    p_entity_id: payload.entity_id,
  })
  if (error) throw databaseError(error, requestId)
  return jsonResponse({ data }, 200, requestId)
}

async function abortComposeClaim(
  db: DatabaseClient,
  orgId: string,
  keyHash: string,
): Promise<void> {
  await db.rpc('abort_email_compose_idempotent', {
    p_org_id: orgId,
    p_idempotency_key_hash: keyHash,
  })
}

export async function composeEntityEmailMessage(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  entityType: ComposeEntityType,
  entityId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (role === 'billing' || role === 'readonly') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This membership cannot send email messages',
    )
  }
  if (!COMPOSE_ENTITY_TYPES.includes(entityType)) {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }

  const rawKey = parseIdempotencyKey(req)
  const plural = entityType === 'contact' ? 'contacts' : entityType === 'lead' ? 'leads' : 'clients'
  const route = `/api/v1/${plural}/${entityId}/email-messages`
  const parsed = validateComposeBody(await jsonBody(req))
  const requestHash = await hashIdempotencyRequest(
    route,
    emailComposeIdempotencyPayload(entityType, entityId, {
      ...parsed,
      to: parsed.to ?? '',
    }),
  )
  const keyHash = await sha256Hex(rawKey)

  const { data: beginData, error: beginError } = await db.rpc(
    'begin_email_compose_idempotent',
    {
      p_org_id: orgId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_idempotency_key_hash: keyHash,
      p_request_hash: requestHash,
      p_route: route,
      ...(parsed.to ? { p_to_address: parsed.to } : {}),
      p_allow_external_recipients: role === 'owner' || role === 'admin'
        ? parsed.allow_external_recipients
        : false,
    },
  )
  if (beginError) {
    const conflict = idempotencyConflictError(beginError)
    if (conflict) throw conflict
    throw databaseError(beginError, requestId)
  }
  if (!beginData || typeof beginData !== 'object' || Array.isArray(beginData)) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Email compose begin returned an unexpected payload',
    )
  }

  const begin = beginData as Record<string, unknown>
  if (begin.replay === true) {
    return replyEnvelopeResponse(
      begin as IdempotencyEnvelope,
      requestId,
      rawKey,
    )
  }

  const mailbox = begin.mailbox as Record<string, unknown> | undefined
  const resolvedTo = typeof begin.to_address === 'string' ? begin.to_address.trim() : ''
  if (!mailbox || !resolvedTo) {
    await abortComposeClaim(db, orgId, keyHash)
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Email compose begin missing mailbox or recipient',
    )
  }

  const payload = {
    to: resolvedTo,
    subject: parsed.subject,
    body_text: parsed.body_text,
    body_html: parsed.body_html,
  }

  const mailboxId = String(mailbox.id ?? '')
  const smtpHost = String(mailbox.smtp_host ?? '')
  const smtpPort = Number(mailbox.smtp_port ?? 0)
  const fromAddress = String(mailbox.email_address ?? '')

  if (!mailbox.credentials_configured) {
    await abortComposeClaim(db, orgId, keyHash)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Mailbox credentials are not configured',
      {
        mailbox: 'Credentials required to send mail',
      },
    )
  }
  if (
    !smtpHost || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535
  ) {
    await abortComposeClaim(db, orgId, keyHash)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Mailbox SMTP settings are incomplete',
      {
        smtp_host: 'Host and port are required',
      },
    )
  }
  if (!fromAddress) {
    await abortComposeClaim(db, orgId, keyHash)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Compose addresses are incomplete',
      {
        from_address: 'Mailbox address required',
      },
    )
  }

  const messageId = generateOutboundMessageId(fromAddress)
  let failureCode: string | null = null
  let smtpReached = false

  try {
    const service = serviceRoleClient()
    const resolved = await resolveMailboxAuth(service, mailboxId, orgId)
    if (!resolved) {
      await abortComposeClaim(db, orgId, keyHash)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Mailbox credentials are not configured',
        {
          mailbox: 'Connect your mailbox or save a password to send mail',
        },
      )
    }

    const security = parseSmtpSecurity(
      resolved.row.smtp_security ?? mailbox.smtp_security,
    )
    smtpReached = true
    await smtpMailSender({
      host: smtpHost,
      port: smtpPort,
      security,
      auth: resolved.smtpAuth,
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      bodyText: payload.body_text,
      bodyHtml: payload.body_html,
      messageId,
    })
  } catch (error) {
    if (error instanceof ApiError) throw error

    if (error instanceof SmtpSendError) {
      failureCode = error.code
    } else {
      failureCode = 'smtp_send_failed'
    }
    console.error('SMTP compose failed', {
      request_id: requestId,
      code: failureCode,
      synthetic: isSyntheticSmtpHost(smtpHost),
    })

    if (smtpReached) {
      const { data: failData, error: failError } = await db.rpc(
        'finish_email_compose_idempotent',
        {
          p_org_id: orgId,
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_to_address: payload.to,
          p_subject: payload.subject,
          p_body_text: payload.body_text,
          p_body_html: payload.body_html,
          p_provider_message_id: messageId,
          p_status: 'failed',
          p_failure_code: failureCode,
          p_idempotency_key_hash: keyHash,
        },
      )
      if (failError) {
        await abortComposeClaim(db, orgId, keyHash)
        throw databaseError(failError, requestId)
      }
      await abortComposeClaim(db, orgId, keyHash)
      const failEnvelope = failData as IdempotencyEnvelope
      return jsonResponse(
        failEnvelope?.response_body ?? {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Outbound SMTP delivery failed',
            request_id: requestId,
          },
        },
        failEnvelope?.response_status ?? 502,
        requestId,
        { [IDEMPOTENCY_KEY_HEADER]: rawKey },
      )
    }

    await abortComposeClaim(db, orgId, keyHash)
    throw new ApiError(502, 'INTERNAL_ERROR', 'Outbound SMTP delivery failed')
  }

  const { data: finishData, error: finishError } = await db.rpc(
    'finish_email_compose_idempotent',
    {
      p_org_id: orgId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_to_address: payload.to,
      p_subject: payload.subject,
      p_body_text: payload.body_text,
      p_body_html: payload.body_html,
      p_provider_message_id: messageId,
      p_status: 'sent',
      p_failure_code: null,
      p_idempotency_key_hash: keyHash,
    },
  )
  if (finishError) {
    await abortComposeClaim(db, orgId, keyHash)
    throw databaseError(finishError, requestId)
  }
  if (
    !finishData || typeof finishData !== 'object' || Array.isArray(finishData)
  ) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Email compose finish returned an unexpected payload',
    )
  }
  return replyEnvelopeResponse(
    finishData as IdempotencyEnvelope,
    requestId,
    rawKey,
  )
}

async function ingestInboundMessage(
  service: SupabaseClient,
  orgId: string,
  mailboxId: string,
  message: InboundImapMessage,
): Promise<void> {
  const { error } = await service.rpc('upsert_inbound_email_message', {
    p_org_id: orgId,
    p_mailbox_id: mailboxId,
    p_provider_message_id: message.provider_message_id,
    p_provider_thread_id: message.provider_thread_id,
    p_from_address: message.from_address,
    p_from_name: message.from_name,
    p_to_addresses: message.to_addresses,
    p_subject: message.subject,
    p_body_text: message.body_text,
    p_preview_text: message.preview_text,
    p_received_at: message.received_at,
    p_body_truncated: message.body_truncated,
    p_body_html: message.body_html,
    p_cc_addresses: message.cc_addresses ?? [],
    p_metadata: { attachments: message.attachments ?? [] },
    p_imap_uid: message.imap_uid,
  })
  if (error) throw error
}

async function ingestInboundMessages(
  service: SupabaseClient,
  orgId: string,
  mailboxId: string,
  messages: InboundImapMessage[],
): Promise<number> {
  let ingested = 0
  for (const message of messages) {
    await ingestInboundMessage(service, orgId, mailboxId, message)
    ingested += 1
  }
  return ingested
}

export type MailboxSyncCycleResult = {
  ok: boolean
  ingested: number
  error_code: string | null
  /** Present on failure — short safe copy for clients (no secrets). */
  message: string | null
  /** Present on failure — pipeline step hint (connect/login/select/search/fetch/…). */
  step: string | null
  catchup_complete?: boolean
  sync_high_uid?: number | null
  sync_low_uid?: number | null
}

function syncFailureResult(
  ingested: number,
  errorCode: string,
  step: string | null = null,
  extra: Partial<MailboxSyncCycleResult> = {},
): MailboxSyncCycleResult {
  const meta = safeMailboxSyncFailureMessage(errorCode, step)
  return {
    ok: false,
    ingested,
    error_code: errorCode,
    message: meta.message,
    step: meta.step,
    ...extra,
  }
}

function cursorFromClaim(claimed: Record<string, unknown>): MailboxSyncCursor {
  const uidvalidity = claimed.imap_uidvalidity == null ? null : Number(claimed.imap_uidvalidity)
  return {
    uidvalidity: Number.isFinite(uidvalidity) && uidvalidity! > 0 ? uidvalidity : null,
    highUid: claimed.sync_high_uid == null ? null : Number(claimed.sync_high_uid),
    lowUid: claimed.sync_low_uid == null ? null : Number(claimed.sync_low_uid),
    catchupComplete: claimed.sync_catchup_complete === true,
  }
}

/** Sync cycle: synthetic for *.example.test; real IMAP for all other hosts. */
export async function runMailboxSyncCycle(
  mailboxId: string,
  holder: string,
  contactEmailForSeed?: string,
): Promise<MailboxSyncCycleResult> {
  const service = serviceRoleClient()
  const { data: claim, error: claimError } = await service.rpc(
    'claim_mailbox_sync_lease',
    {
      p_mailbox_id: mailboxId,
      p_holder: holder,
      p_lease_seconds: 120,
    },
  )
  if (claimError) {
    console.error('claim lease failed', { code: claimError.code })
    return syncFailureResult(0, 'lease_error')
  }
  const claimed = claim as Record<string, unknown>
  if (!claimed?.claimed) {
    return syncFailureResult(0, String(claimed?.reason ?? 'not_claimed'))
  }

  const orgId = String(claimed.org_id)
  const imapHost = String(claimed.imap_host ?? '')
  const maxMessages = Math.min(
    80,
    Math.max(1, Number(claimed.sync_max_messages ?? 50)),
  )
  const maxBody = Number(claimed.sync_max_body_bytes ?? 262144)
  const lookbackDays = Number(claimed.sync_lookback_days ?? 14)
  let ingested = 0
  let authFailed = false
  let errorCode: string | null = null
  let failureStep: string | null = null
  let catchupComplete = claimed.sync_catchup_complete === true
  let highUid = claimed.sync_high_uid == null ? null : Number(claimed.sync_high_uid)
  let lowUid = claimed.sync_low_uid == null ? null : Number(claimed.sync_low_uid)

  try {
    if (!claimed.credentials_configured) {
      errorCode = 'credentials_missing'
    } else if (isSyntheticImapHost(imapHost)) {
      const peer = contactEmailForSeed ?? 'peer@example.test'
      const body =
        `Hello from Wave B sync skeleton.\n\nThis is a synthetic inbound message for staging proofs.`
      const truncated = body.length > maxBody
      const bodyText = truncated ? body.slice(0, maxBody) : body
      const count = Math.min(1, maxMessages)
      const synthetic: InboundImapMessage[] = []
      for (let i = 0; i < count; i++) {
        const providerId = `synth-${mailboxId}-${Date.now()}-${i}`
        synthetic.push({
          provider_message_id: providerId,
          provider_thread_id: `thread-${providerId}`,
          from_address: peer,
          from_name: 'Wave B Peer',
          to_addresses: [{ email: String(claimed.email_address), name: null }],
          cc_addresses: [],
          subject: 'Wave B sync skeleton message',
          body_text: bodyText,
          body_html: null,
          preview_text: bodyText.slice(0, 160),
          received_at: new Date().toISOString(),
          body_truncated: truncated,
          imap_uid: null,
          attachments: [],
        })
      }
      ingested = await ingestInboundMessages(
        service,
        orgId,
        mailboxId,
        synthetic,
      )
      catchupComplete = true
      await service.rpc('set_mailbox_sync_catchup', {
        p_mailbox_id: mailboxId,
        p_uidvalidity: 1,
        p_catchup_complete: true,
      })
    } else {
      const resolved = await resolveMailboxAuth(service, mailboxId)
      if (!resolved) {
        errorCode = 'credentials_missing'
      } else {
        const securityRaw = String(resolved.row.imap_security ?? 'tls')
        const security: ImapSecurity = securityRaw === 'starttls' || securityRaw === 'none'
          ? securityRaw
          : 'tls'
        const result = await imapInboxSync({
          host: imapHost,
          port: Number(claimed.imap_port ?? 993),
          security,
          auth: resolved.imapAuth,
          lookbackDays,
          maxMessages,
          maxBodyBytes: maxBody,
          cursor: cursorFromClaim(claimed),
          onProgress: async ({ message, cursor, uidvalidity, mode }) => {
            await ingestInboundMessage(service, orgId, mailboxId, message)
            ingested += 1
            if (message.imap_uid != null) {
              await service.rpc('advance_mailbox_sync_cursor', {
                p_mailbox_id: mailboxId,
                p_uidvalidity: uidvalidity,
                p_uid: message.imap_uid,
                p_mode: mode,
                p_catchup_complete: cursor.catchupComplete,
              })
            }
            highUid = cursor.highUid
            lowUid = cursor.lowUid
            catchupComplete = cursor.catchupComplete
          },
        })
        if (ingested === 0 && result.messages.length > 0) {
          ingested = await ingestInboundMessages(
            service,
            orgId,
            mailboxId,
            result.messages,
          )
        }
        catchupComplete = result.cursor.catchupComplete
        highUid = result.cursor.highUid
        lowUid = result.cursor.lowUid
        await service.rpc('set_mailbox_sync_catchup', {
          p_mailbox_id: mailboxId,
          p_uidvalidity: result.uidvalidity,
          p_catchup_complete: result.cursor.catchupComplete,
        })
        await service.rpc('relink_mailbox_email_messages', {
          p_org_id: orgId,
          p_mailbox_id: mailboxId,
        })
        if (result.timedOut && ingested === 0) {
          errorCode = 'timeout'
          failureStep = 'fetch'
        }
      }
    }

    await service.rpc('release_mailbox_sync_lease', {
      p_mailbox_id: mailboxId,
      p_holder: holder,
      p_ok: errorCode === null,
      p_error_code: errorCode,
      p_auth_failed: authFailed,
    })
    if (errorCode !== null) {
      return syncFailureResult(ingested, errorCode, failureStep, {
        catchup_complete: catchupComplete,
        sync_high_uid: highUid,
        sync_low_uid: lowUid,
      })
    }
    return {
      ok: true,
      ingested,
      error_code: null,
      message: null,
      step: null,
      catchup_complete: catchupComplete,
      sync_high_uid: highUid,
      sync_low_uid: lowUid,
    }
  } catch (error) {
    if (error instanceof ImapSyncError) {
      authFailed = error.authFailed
      errorCode = error.code
      failureStep = error.step
      await service.rpc('release_mailbox_sync_lease', {
        p_mailbox_id: mailboxId,
        p_holder: holder,
        p_ok: false,
        p_error_code: error.code,
        p_auth_failed: authFailed,
      })
      return syncFailureResult(ingested, error.code, error.step, {
        catchup_complete: catchupComplete,
        sync_high_uid: highUid,
        sync_low_uid: lowUid,
      })
    }
    const message = error instanceof Error ? error.message : 'sync_failed'
    authFailed = /auth/i.test(message)
    await service.rpc('release_mailbox_sync_lease', {
      p_mailbox_id: mailboxId,
      p_holder: holder,
      p_ok: false,
      p_error_code: 'sync_failed',
      p_auth_failed: authFailed,
    })
    return syncFailureResult(ingested, 'sync_failed', null, {
      catchup_complete: catchupComplete,
      sync_high_uid: highUid,
      sync_low_uid: lowUid,
    })
  }
}

async function postMailboxSync(
  db: DatabaseClient,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (role === 'billing' || role === 'readonly') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This membership cannot sync mailboxes',
    )
  }
  const { data: mailbox, error } = await db.rpc('get_mailbox_account', {
    p_org_id: orgId,
  })
  if (error) throw databaseError(error, requestId)
  if (!mailbox || typeof mailbox !== 'object') {
    throw new ApiError(404, 'NOT_FOUND', 'Mailbox not found')
  }
  const mailboxId = String((mailbox as Record<string, unknown>).id)
  const result = await runMailboxSyncCycle(mailboxId, `api-${requestId}`)
  return jsonResponse({ data: result }, 200, requestId)
}

export function handleEmailMessages(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/me/mailbox/sync') {
    if (req.method !== 'POST') {
      throw new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed for mailbox sync',
      )
    }
    return postMailboxSync(db, orgId, role, requestId)
  }

  const shareMatch = path.match(
    /^\/api\/v1\/email-messages\/([0-9a-f-]{36})\/share$/i,
  )
  if (shareMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed for email share',
      )
    }
    return shareEmailMessage(req, db, orgId, shareMatch[1], role, requestId)
  }

  const replyMatch = path.match(
    /^\/api\/v1\/email-messages\/([0-9a-f-]{36})\/reply$/i,
  )
  if (replyMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed for email reply',
      )
    }
    return replyEmailMessage(req, db, orgId, replyMatch[1], role, requestId)
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
