import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { ApiError, jsonBody, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

export const AI_PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

function assertCanReadIntegrations(role: MembershipRole): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access integrations')
  }
}

function assertCanWriteAiIntegrations(role: MembershipRole): void {
  assertCanReadIntegrations(role)
  if (role !== 'owner') {
    throw new ApiError(403, 'FORBIDDEN', 'Only owners can connect AI providers')
  }
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', 'Integration operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'Integration not found')
  }
  if (error.code === '22023' || message.includes('api key')) {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'Integration validation failed')
  }
  console.error('Integration operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The integration operation failed')
}

/** True when payload JSON includes forbidden secret *keys* (not values like auth_mode). */
export function payloadHasForbiddenSecretKey(payload: unknown): boolean {
  const text = JSON.stringify(payload)
  return (
    /"secret_ref"\s*:/.test(text) ||
    /"password"\s*:/.test(text) ||
    /"api_key"\s*:/.test(text)
  )
}

function assertNoSecretEcho(payload: unknown): void {
  if (payloadHasForbiddenSecretKey(payload)) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Integration response contained a forbidden secret field',
    )
  }
}

export function parseAiProvider(value: string): AiProvider {
  if ((AI_PROVIDERS as readonly string[]).includes(value)) return value as AiProvider
  throw new ApiError(404, 'NOT_FOUND', 'Unknown AI provider')
}

export function validateAiConnectBody(body: Record<string, unknown>): { api_key: string } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'api_key') fields[key] = 'Field is not writable'
  }
  const apiKey = typeof body.api_key === 'string' ? body.api_key : null
  if (apiKey === null || apiKey.trim().length < 8) {
    fields.api_key = 'Must be a string of at least 8 characters'
  } else if (apiKey.length > 4096) {
    fields.api_key = 'Must be at most 4096 characters'
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'AI integration validation failed', fields)
  }
  return { api_key: apiKey!.trim() }
}

async function listIntegrations(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('list_ai_integrations', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data: data ?? [] }, 200, requestId)
}

async function putAiIntegration(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  provider: AiProvider,
  requestId: string,
): Promise<Response> {
  const payload = validateAiConnectBody(await jsonBody(req))
  const { data, error } = await db.rpc('upsert_ai_integration', {
    p_org_id: orgId,
    p_provider: provider,
    p_api_key: payload.api_key,
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

async function deleteAiIntegration(
  db: DatabaseClient,
  orgId: string,
  provider: AiProvider,
  requestId: string,
): Promise<Response> {
  const { error } = await db.rpc('disconnect_ai_integration', {
    p_org_id: orgId,
    p_provider: provider,
  })
  if (error) throw databaseError(error, requestId)
  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

export function handleIntegrations(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/integrations') {
    assertCanReadIntegrations(role)
    if (req.method === 'GET') return listIntegrations(db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for integrations')
  }

  const aiMatch = path.match(/^\/api\/v1\/integrations\/ai\/([a-z]+)$/i)
  if (aiMatch) {
    const provider = parseAiProvider(aiMatch[1].toLowerCase())
    if (req.method === 'PUT') {
      assertCanWriteAiIntegrations(role)
      return putAiIntegration(req, db, orgId, provider, requestId)
    }
    if (req.method === 'DELETE') {
      assertCanWriteAiIntegrations(role)
      return deleteAiIntegration(db, orgId, provider, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for AI integrations')
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
