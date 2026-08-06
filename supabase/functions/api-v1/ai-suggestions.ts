import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { buildToneAwareUserContent, runOrgAiCompletion } from './ai-provider.ts'
import { ApiError, jsonBody, jsonResponse, parseUuid } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

function assertCanUseAi(role: MembershipRole): void {
  if (role === 'billing' || role === 'readonly') {
    throw new ApiError(403, 'FORBIDDEN', 'This membership cannot use AI suggestions')
  }
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'AI suggestion operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'AI suggestion not found')
  }
  if (error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'AI suggestion validation failed')
  }
  console.error('AI suggestion operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
    message: error.message ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The AI suggestion operation failed')
}

/** Drop a trailing TONE: line if the model echoed the injected instruction. */
export function sanitizeAiOutput(text: string): string {
  return text.replace(/\n*TONE:\s*\S+\s*$/i, '').trim()
}

export function validateGenerateBody(
  body: Record<string, unknown>,
): { email_message_id: string; variant: string } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'email_message_id' && key !== 'variant') fields[key] = 'Field is not writable'
  }
  let messageId = ''
  try {
    messageId = parseUuid(
      typeof body.email_message_id === 'string' ? body.email_message_id : '',
      'email_message_id',
    )
  } catch {
    fields.email_message_id = 'Must be a UUID'
  }
  const variant = typeof body.variant === 'string' && body.variant.trim()
    ? body.variant.trim()
    : 'neutral'
  if (variant.length > 40) fields.variant = 'Must be at most 40 characters'
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Generate validation failed', fields)
  }
  return { email_message_id: messageId, variant }
}

export function validateInvoiceChaseBody(
  body: Record<string, unknown>,
): { invoice_id: string; variant: string } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'invoice_id' && key !== 'variant') fields[key] = 'Field is not writable'
  }
  let invoiceId = ''
  try {
    invoiceId = parseUuid(
      typeof body.invoice_id === 'string' ? body.invoice_id : '',
      'invoice_id',
    )
  } catch {
    fields.invoice_id = 'Must be a UUID'
  }
  const variant = typeof body.variant === 'string' && body.variant.trim()
    ? body.variant.trim()
    : 'polite'
  if (variant.length > 40) fields.variant = 'Must be at most 40 characters'
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Generate validation failed', fields)
  }
  return { invoice_id: invoiceId, variant }
}

export function validateDecideBody(
  body: Record<string, unknown>,
): { accepted_text: string | null } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'accepted_text') fields[key] = 'Field is not writable'
  }
  let accepted: string | null = null
  if ('accepted_text' in body) {
    if (body.accepted_text === null) accepted = null
    else if (typeof body.accepted_text === 'string') accepted = body.accepted_text
    else fields.accepted_text = 'Must be a string or null'
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Decide validation failed', fields)
  }
  return { accepted_text: accepted }
}

async function generateEmailReply(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  assertCanUseAi(role)
  const payload = validateGenerateBody(await jsonBody(req))

  const { data: context, error: contextError } = await db.rpc('get_email_message_ai_context', {
    p_org_id: orgId,
    p_message_id: payload.email_message_id,
  })
  if (contextError) throw databaseError(contextError, requestId)
  const ctx = (context ?? {}) as Record<string, unknown>
  const subject = typeof ctx.subject === 'string' ? ctx.subject : ''
  const fromAddress = typeof ctx.from_address === 'string' ? ctx.from_address : ''
  const fromName = typeof ctx.from_name === 'string' ? ctx.from_name : ''
  const bodyText = typeof ctx.body_text === 'string' ? ctx.body_text : ''

  const completion = await runOrgAiCompletion(
    db,
    orgId,
    'email_reply',
    buildToneAwareUserContent({
      contextLabel: 'Source email',
      contextBody: [
        `From: ${fromName ? `${fromName} <${fromAddress}>` : fromAddress || 'unknown'}`,
        `Subject: ${subject || '(no subject)'}`,
        '',
        bodyText || '(empty body)',
      ].join('\n'),
      tone: payload.variant,
    }),
  )

  const { data, error } = await db.rpc('create_email_reply_suggestion', {
    p_org_id: orgId,
    p_message_id: payload.email_message_id,
    p_output_text: sanitizeAiOutput(completion.text),
    p_model_provider: completion.provider,
    p_model_name: completion.model,
    p_variant: payload.variant,
    p_prompt_text: completion.prompt,
    p_prompt_version: completion.promptVersion,
  })
  if (error) throw databaseError(error, requestId)
  return jsonResponse({ data }, 201, requestId)
}

async function generateInvoiceChase(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  assertCanUseAi(role)
  const payload = validateInvoiceChaseBody(await jsonBody(req))

  const { data: invoice, error: invoiceError } = await db
    .from('invoices')
    .select('id,number,due_on,total_cents,currency,party_snapshot,balance_due_cents')
    .eq('org_id', orgId)
    .eq('id', payload.invoice_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (invoiceError) throw databaseError(invoiceError, requestId)
  if (!invoice) {
    throw new ApiError(404, 'NOT_FOUND', 'Invoice not found')
  }

  const party = (invoice.party_snapshot ?? {}) as Record<string, unknown>
  const clientName = typeof party.name === 'string' && party.name.trim()
    ? party.name.trim()
    : typeof party.client_name === 'string' && party.client_name.trim()
    ? party.client_name.trim()
    : 'there'

  const completion = await runOrgAiCompletion(
    db,
    orgId,
    'invoice_chase',
    buildToneAwareUserContent({
      contextLabel: 'Invoice to chase',
      contextBody: [
        `Client: ${clientName}`,
        `Invoice: ${invoice.number}`,
        `Due on: ${invoice.due_on ?? 'unknown'}`,
        `Currency: ${invoice.currency}`,
        `Total cents: ${invoice.total_cents}`,
        `Balance due cents: ${invoice.balance_due_cents}`,
      ].join('\n'),
      tone: payload.variant,
    }),
  )

  const { data, error } = await db.rpc('create_invoice_chase_suggestion', {
    p_org_id: orgId,
    p_invoice_id: payload.invoice_id,
    p_output_text: sanitizeAiOutput(completion.text),
    p_model_provider: completion.provider,
    p_model_name: completion.model,
    p_variant: payload.variant,
    p_prompt_version: completion.promptVersion,
  })
  if (error) throw databaseError(error, requestId)
  return jsonResponse({ data }, 201, requestId)
}

async function decideSuggestion(
  db: DatabaseClient,
  orgId: string,
  suggestionId: string,
  decision: 'use' | 'discard',
  role: MembershipRole,
  requestId: string,
  acceptedText: string | null,
): Promise<Response> {
  assertCanUseAi(role)
  const { data, error } = await db.rpc('decide_ai_suggestion', {
    p_org_id: orgId,
    p_suggestion_id: suggestionId,
    p_decision: decision,
    p_accepted_text: acceptedText,
  })
  if (error) throw databaseError(error, requestId)
  return jsonResponse({ data }, 200, requestId)
}

export async function handleAiSuggestions(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/ai-suggestions/email-reply' && req.method === 'POST') {
    return generateEmailReply(req, db, orgId, role, requestId)
  }

  if (path === '/api/v1/ai-suggestions/invoice-chase' && req.method === 'POST') {
    return generateInvoiceChase(req, db, orgId, role, requestId)
  }

  const useMatch = path.match(/^\/api\/v1\/ai-suggestions\/([0-9a-f-]{36})\/use$/i)
  if (useMatch && req.method === 'POST') {
    let accepted: string | null = null
    const raw = await req.text()
    if (raw.trim()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new ApiError(400, 'BAD_REQUEST', 'Request body is not valid JSON')
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ApiError(400, 'BAD_REQUEST', 'Request body must be a JSON object')
      }
      accepted = validateDecideBody(parsed as Record<string, unknown>).accepted_text
    }
    return decideSuggestion(db, orgId, useMatch[1], 'use', role, requestId, accepted)
  }

  const discardMatch = path.match(/^\/api\/v1\/ai-suggestions\/([0-9a-f-]{36})\/discard$/i)
  if (discardMatch && req.method === 'POST') {
    return decideSuggestion(db, orgId, discardMatch[1], 'discard', role, requestId, null)
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
