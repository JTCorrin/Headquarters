import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { ApiError, jsonBody, jsonResponse, parseUuid } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

function serviceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Service credentials are unavailable')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Email operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Email resource not found')
  }
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
    if (key !== 'entity_type' && key !== 'entity_id') fields[key] = 'Field is not writable'
  }
  const entityType = typeof body.entity_type === 'string' ? body.entity_type : ''
  if (!['contact', 'lead', 'client'].includes(entityType)) {
    fields.entity_type = 'Must be contact, lead, or client'
  }
  let entityId = ''
  try {
    entityId = parseUuid(typeof body.entity_id === 'string' ? body.entity_id : '', 'entity_id')
  } catch {
    fields.entity_id = 'Must be a UUID'
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Share validation failed', fields)
  }
  return {
    entity_type: entityType as 'contact' | 'lead' | 'client',
    entity_id: entityId,
  }
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
    throw new ApiError(403, 'FORBIDDEN', 'This membership cannot share email messages')
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

/** Wave B sync skeleton: synthetic IMAP for *.example.test hosts; respects lease + bounds. */
export async function runMailboxSyncCycle(
  mailboxId: string,
  holder: string,
  contactEmailForSeed?: string,
): Promise<{ ok: boolean; ingested: number; error_code: string | null }> {
  const service = serviceRoleClient()
  const { data: claim, error: claimError } = await service.rpc('claim_mailbox_sync_lease', {
    p_mailbox_id: mailboxId,
    p_holder: holder,
    p_lease_seconds: 120,
  })
  if (claimError) {
    console.error('claim lease failed', { code: claimError.code })
    return { ok: false, ingested: 0, error_code: 'lease_error' }
  }
  const claimed = claim as Record<string, unknown>
  if (!claimed?.claimed) {
    return {
      ok: false,
      ingested: 0,
      error_code: String(claimed?.reason ?? 'not_claimed'),
    }
  }

  const orgId = String(claimed.org_id)
  const imapHost = String(claimed.imap_host ?? '')
  const maxMessages = Number(claimed.sync_max_messages ?? 100)
  const maxBody = Number(claimed.sync_max_body_bytes ?? 262144)
  let ingested = 0
  const authFailed = false
  let errorCode: string | null = null

  try {
    if (!claimed.credentials_configured) {
      errorCode = 'credentials_missing'
    } else if (imapHost.endsWith('.example.test') || imapHost === 'imap.example.test') {
      // Skeleton ingest for staging proofs — exact-address match to seeded contact email.
      const peer = contactEmailForSeed ?? 'peer@example.test'
      const body =
        `Hello from Wave B sync skeleton.\n\nThis is a synthetic inbound message for staging proofs.`
      const truncated = body.length > maxBody
      const bodyText = truncated ? body.slice(0, maxBody) : body
      const count = Math.min(1, maxMessages)
      for (let i = 0; i < count; i++) {
        const providerId = `synth-${mailboxId}-${Date.now()}-${i}`
        const { error } = await service.rpc('upsert_inbound_email_message', {
          p_org_id: orgId,
          p_mailbox_id: mailboxId,
          p_provider_message_id: providerId,
          p_provider_thread_id: `thread-${providerId}`,
          p_from_address: peer,
          p_from_name: 'Wave B Peer',
          p_to_addresses: [{ email: String(claimed.email_address), name: null }],
          p_subject: 'Wave B sync skeleton message',
          p_body_text: bodyText,
          p_preview_text: bodyText.slice(0, 160),
          p_received_at: new Date().toISOString(),
          p_body_truncated: truncated,
        })
        if (error) throw error
        ingested += 1
      }
    } else {
      // Real IMAP deferred — mark skipped without opening circuit.
      errorCode = 'imap_not_configured_for_host'
    }

    await service.rpc('release_mailbox_sync_lease', {
      p_mailbox_id: mailboxId,
      p_holder: holder,
      p_ok: errorCode === null || errorCode === 'imap_not_configured_for_host',
      p_error_code: errorCode,
      p_auth_failed: authFailed,
    })
    return {
      ok: errorCode === null || errorCode === 'imap_not_configured_for_host',
      ingested,
      error_code: errorCode,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed'
    await service.rpc('release_mailbox_sync_lease', {
      p_mailbox_id: mailboxId,
      p_holder: holder,
      p_ok: false,
      p_error_code: 'sync_failed',
      p_auth_failed: /auth/i.test(message),
    })
    return { ok: false, ingested, error_code: 'sync_failed' }
  }
}

async function postMailboxSync(
  db: DatabaseClient,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (role === 'billing' || role === 'readonly') {
    throw new ApiError(403, 'FORBIDDEN', 'This membership cannot sync mailboxes')
  }
  const { data: mailbox, error } = await db.rpc('get_mailbox_account', { p_org_id: orgId })
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
  if (path === '/api/v1/me/mailbox/sync' && req.method === 'POST') {
    return postMailboxSync(db, orgId, role, requestId)
  }

  const shareMatch = path.match(
    /^\/api\/v1\/email-messages\/([0-9a-f-]{36})\/share$/i,
  )
  if (shareMatch) {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for email share')
    }
    return shareEmailMessage(req, db, orgId, shareMatch[1], role, requestId)
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
