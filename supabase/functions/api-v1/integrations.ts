import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import {
  DEFAULT_AI_PROMPTS,
  mergeEffectivePrompts,
  validateAiPromptsPutBody,
} from './ai-prompts.ts'
import { type AiProviderName, listProviderModels } from './ai-provider.ts'
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

function assertCanWriteAiPrompts(role: MembershipRole): void {
  assertCanWriteAiIntegrations(role)
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

export function validateAiModelBody(body: Record<string, unknown>): { model: string } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'model') fields[key] = 'Field is not writable'
  }
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (model.length < 1) {
    fields.model = 'Must be a non-empty string'
  } else if (model.length > 256) {
    fields.model = 'Must be at most 256 characters'
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'AI model validation failed', fields)
  }
  return { model }
}

function serviceRoleClient(): DatabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Service credentials are unavailable')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function readProviderApiKey(
  orgId: string,
  provider: AiProvider,
  requestId: string,
): Promise<string> {
  const service = serviceRoleClient()
  const { data: creds, error } = await service.rpc('read_ai_integration_credentials', {
    p_org_id: orgId,
    p_provider: provider,
  })
  if (error) throw databaseError(error, requestId)
  const apiKey = creds && typeof creds === 'object' && !Array.isArray(creds)
    ? (creds as Record<string, unknown>).api_key
    : null
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new ApiError(409, 'CONFLICT', 'AI integration credentials are unavailable')
  }
  return apiKey.trim()
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

function overridesFromRpc(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const overrides = (data as Record<string, unknown>).overrides
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {}
  return overrides as Record<string, unknown>
}

function versionFromRpc(data: unknown): number {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0
  const version = (data as Record<string, unknown>).version
  return typeof version === 'number' && Number.isFinite(version) ? version : 0
}

async function getAiPrompts(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('get_ai_org_prompts', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  const overrides = overridesFromRpc(data)
  const effective = mergeEffectivePrompts(overrides)
  return jsonResponse(
    {
      data: {
        version: versionFromRpc(data),
        overrides,
        defaults: DEFAULT_AI_PROMPTS,
        effective,
      },
    },
    200,
    requestId,
  )
}

async function listAiModels(
  db: DatabaseClient,
  orgId: string,
  provider: AiProvider,
  requestId: string,
): Promise<Response> {
  // Ensure the integration is connected for this org before reading secrets.
  const { data: integrations, error } = await db.rpc('list_ai_integrations', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  const row = (Array.isArray(integrations) ? integrations : []).find((item) => {
    const r = item as Record<string, unknown>
    return r.provider === provider && r.credentials_configured === true && r.status === 'active'
  })
  if (!row) {
    throw new ApiError(409, 'CONFLICT', 'Connect this AI provider before listing models')
  }
  const apiKey = await readProviderApiKey(orgId, provider, requestId)
  const models = await listProviderModels(provider as AiProviderName, apiKey)
  const selectedModel = typeof (row as Record<string, unknown>).selected_model === 'string'
    ? String((row as Record<string, unknown>).selected_model)
    : null
  return jsonResponse(
    {
      data: {
        provider,
        selected_model: selectedModel,
        models,
      },
    },
    200,
    requestId,
  )
}

async function putAiModel(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  provider: AiProvider,
  requestId: string,
): Promise<Response> {
  const payload = validateAiModelBody(await jsonBody(req))
  const { data, error } = await db.rpc('set_ai_integration_model', {
    p_org_id: orgId,
    p_provider: provider,
    p_model: payload.model,
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

async function putAiPrompts(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateAiPromptsPutBody(await jsonBody(req))
  const { data, error } = await db.rpc('upsert_ai_org_prompts', {
    p_org_id: orgId,
    p_prompts: payload,
  })
  if (error) throw databaseError(error, requestId)
  const overrides = overridesFromRpc(data)
  const effective = mergeEffectivePrompts(overrides)
  return jsonResponse(
    {
      data: {
        version: versionFromRpc(data),
        overrides,
        defaults: DEFAULT_AI_PROMPTS,
        effective,
      },
    },
    200,
    requestId,
  )
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

  if (path === '/api/v1/integrations/ai/prompts') {
    assertCanReadIntegrations(role)
    if (req.method === 'GET') return getAiPrompts(db, orgId, requestId)
    if (req.method === 'PUT') {
      assertCanWriteAiPrompts(role)
      return putAiPrompts(req, db, orgId, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for AI prompts')
  }

  const aiModelsMatch = path.match(/^\/api\/v1\/integrations\/ai\/([a-z]+)\/models$/i)
  if (aiModelsMatch) {
    const provider = parseAiProvider(aiModelsMatch[1].toLowerCase())
    assertCanReadIntegrations(role)
    if (req.method === 'GET') return listAiModels(db, orgId, provider, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for AI models')
  }

  const aiModelMatch = path.match(/^\/api\/v1\/integrations\/ai\/([a-z]+)\/model$/i)
  if (aiModelMatch) {
    const provider = parseAiProvider(aiModelMatch[1].toLowerCase())
    if (req.method === 'PUT') {
      assertCanWriteAiIntegrations(role)
      return putAiModel(req, db, orgId, provider, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for AI model')
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
