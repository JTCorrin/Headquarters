import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import {
  type AiPromptKey,
  buildInvoiceChaseStubDraft,
  mergeEffectivePrompts,
  promptVersionFor,
} from './ai-prompts.ts'
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

async function loadEffectivePrompt(
  db: DatabaseClient,
  orgId: string,
  key: AiPromptKey,
  requestId: string,
): Promise<{ prompt: string; promptVersion: string }> {
  const { data, error } = await db.rpc('get_ai_org_prompts', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  const overrides = data && typeof data === 'object' && !Array.isArray(data)
    ? ((data as Record<string, unknown>).overrides as Record<string, unknown> | undefined)
    : undefined
  const effective = mergeEffectivePrompts(overrides)
  const prompt = effective[key]
  return { prompt, promptVersion: await promptVersionFor(prompt) }
}

async function requireActiveAiProvider(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<string> {
  const { data: integrations, error: listError } = await db.rpc('list_ai_integrations', {
    p_org_id: orgId,
  })
  if (listError) throw databaseError(listError, requestId)
  const active = (Array.isArray(integrations) ? integrations : []).find((row) => {
    const r = row as Record<string, unknown>
    return r.credentials_configured === true && r.status === 'active'
  }) as Record<string, unknown> | undefined
  if (!active) {
    throw new ApiError(409, 'CONFLICT', 'No active AI integration is connected')
  }
  return String(active.provider ?? 'openrouter')
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
  const provider = await requireActiveAiProvider(db, orgId, requestId)
  const { prompt, promptVersion } = await loadEffectivePrompt(
    db,
    orgId,
    'email_reply',
    requestId,
  )

  // Empty p_output_text → RPC synthesizes using prompt + TONE inject (no per-tone sentences).
  const { data, error } = await db.rpc('create_email_reply_suggestion', {
    p_org_id: orgId,
    p_message_id: payload.email_message_id,
    p_output_text: '',
    p_model_provider: provider,
    p_model_name: 'wave-b-local-draft',
    p_variant: payload.variant,
    p_prompt_text: prompt,
    p_prompt_version: promptVersion,
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
  const provider = await requireActiveAiProvider(db, orgId, requestId)
  const { promptVersion } = await loadEffectivePrompt(db, orgId, 'invoice_chase', requestId)

  const { data: invoice, error: invoiceError } = await db
    .from('invoices')
    .select('id,number,due_on,party_snapshot')
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

  const output = buildInvoiceChaseStubDraft({
    clientName,
    invoiceNumber: invoice.number,
    dueOn: invoice.due_on,
    tone: payload.variant,
  })

  const { data, error } = await db.rpc('create_invoice_chase_suggestion', {
    p_org_id: orgId,
    p_invoice_id: payload.invoice_id,
    p_output_text: output,
    p_model_provider: provider,
    p_model_name: 'wave-b-local-draft',
    p_variant: payload.variant,
    p_prompt_version: promptVersion,
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
