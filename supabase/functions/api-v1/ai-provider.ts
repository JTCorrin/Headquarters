import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { type AiPromptKey, mergeEffectivePrompts, promptVersionFor } from './ai-prompts.ts'
import { ApiError } from './http.ts'

export type AiProviderName = 'openai' | 'anthropic' | 'google' | 'openrouter'
type DatabaseClient = SupabaseClient<Database>

export interface AiCompletionRequest {
  provider: AiProviderName
  apiKey: string
  /** System / instruction prompt (org template). */
  systemPrompt: string
  /** Entity context + tone lines. */
  userContent: string
  model?: string
}

export interface AiCompletionResult {
  text: string
  model: string
  provider: AiProviderName
}

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-2.0-flash',
  openrouter: 'openai/gpt-4o-mini',
}

function providerError(provider: AiProviderName, status: number, body: string): ApiError {
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 240)
  console.error('AI provider HTTP failed', { provider, status, snippet })
  // Auth failures are org config, not gateway failures — avoid HTTP 502 "Bad Gateway".
  if (status === 401 || status === 403) {
    return new ApiError(
      409,
      'CONFLICT',
      `${provider} rejected the API key — reconnect under Org → Integrations`,
    )
  }
  if (status === 429) {
    return new ApiError(502, 'INTERNAL_ERROR', `${provider} rate limit exceeded`)
  }
  return new ApiError(502, 'INTERNAL_ERROR', `${provider} completion failed`)
}

async function completeOpenAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  provider: AiProviderName,
  extraHeaders: Record<string, string> = {},
): Promise<AiCompletionResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  })
  const raw = await response.text()
  if (!response.ok) throw providerError(provider, response.status, raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError(502, 'INTERNAL_ERROR', `${provider} returned non-JSON`)
  }
  const text = (parsed as {
    choices?: Array<{ message?: { content?: string } }>
  }).choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ApiError(502, 'INTERNAL_ERROR', `${provider} returned an empty completion`)
  }
  return { text: text.trim(), model, provider }
}

async function completeAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<AiCompletionResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0.4,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  })
  const raw = await response.text()
  if (!response.ok) throw providerError('anthropic', response.status, raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError(502, 'INTERNAL_ERROR', 'anthropic returned non-JSON')
  }
  const blocks = (parsed as { content?: Array<{ type?: string; text?: string }> }).content ?? []
  const text = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (!text) {
    throw new ApiError(502, 'INTERNAL_ERROR', 'anthropic returned an empty completion')
  }
  return { text, model, provider: 'anthropic' }
}

async function completeGoogle(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<AiCompletionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${
    encodeURIComponent(model)
  }:generateContent?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0.4 },
    }),
  })
  const raw = await response.text()
  if (!response.ok) throw providerError('google', response.status, raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError(502, 'INTERNAL_ERROR', 'google returned non-JSON')
  }
  const text = (parsed as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')?.trim()
  if (!text) {
    throw new ApiError(502, 'INTERNAL_ERROR', 'google returned an empty completion')
  }
  return { text, model, provider: 'google' }
}

/** Deterministic completions for local/staging without live provider keys. */
export function isAiCompletionStubMode(): boolean {
  try {
    const value = Deno.env.get('AI_COMPLETION_STUB')?.trim().toLowerCase()
    return value === '1' || value === 'true' || value === 'yes'
  } catch {
    return false
  }
}

/** Staging curl proofs use `sk-test-*` keys — never send those to live providers. */
export function shouldStubAiCompletion(apiKey: string, forceStub = false): boolean {
  if (forceStub || isAiCompletionStubMode()) return true
  return /^sk-test-/i.test(apiKey.trim())
}

export async function completeAiPrompt(
  request: AiCompletionRequest,
  options?: { forceStub?: boolean },
): Promise<AiCompletionResult> {
  const model = request.model?.trim() || DEFAULT_MODELS[request.provider]
  if (shouldStubAiCompletion(request.apiKey, options?.forceStub === true)) {
    const promptHint = request.systemPrompt.trim().split(/\n/)[0]?.slice(0, 80) ?? 'AI'
    return {
      text: `STUB completion (${request.provider}/${model}): ${promptHint}\n\n${
        request.userContent.slice(0, 400)
      }`,
      model: `stub-${model}`,
      provider: request.provider,
    }
  }
  switch (request.provider) {
    case 'openai':
      return await completeOpenAiCompatible(
        'https://api.openai.com/v1/chat/completions',
        request.apiKey,
        model,
        request.systemPrompt,
        request.userContent,
        'openai',
      )
    case 'openrouter':
      return await completeOpenAiCompatible(
        'https://openrouter.ai/api/v1/chat/completions',
        request.apiKey,
        model,
        request.systemPrompt,
        request.userContent,
        'openrouter',
        {
          'HTTP-Referer': 'https://headquarters.local',
          'X-Title': 'Headquarters',
        },
      )
    case 'anthropic':
      return await completeAnthropic(
        request.apiKey,
        model,
        request.systemPrompt,
        request.userContent,
      )
    case 'google':
      return await completeGoogle(
        request.apiKey,
        model,
        request.systemPrompt,
        request.userContent,
      )
    default:
      throw new ApiError(422, 'VALIDATION_ERROR', 'Unknown AI provider')
  }
}

export function buildToneAwareUserContent(parts: {
  contextLabel: string
  contextBody: string
  tone?: string | null
}): string {
  const chunks = [
    parts.contextLabel,
    '',
    parts.contextBody.trim(),
  ]
  if (parts.tone && parts.tone.trim() !== '') {
    chunks.push('', `TONE: ${parts.tone.trim()}`)
  }
  return chunks.join('\n')
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

export async function resolveActiveAiProvider(
  db: DatabaseClient,
  orgId: string,
): Promise<AiProviderName> {
  const { data: integrations, error } = await db.rpc('list_ai_integrations', {
    p_org_id: orgId,
  })
  if (error) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not list AI integrations')
  }
  const active = (Array.isArray(integrations) ? integrations : []).find((row) => {
    const r = row as Record<string, unknown>
    return r.credentials_configured === true && r.status === 'active'
  }) as Record<string, unknown> | undefined
  if (!active) {
    throw new ApiError(409, 'CONFLICT', 'No active AI integration is connected')
  }
  const provider = String(active.provider ?? 'openrouter') as AiProviderName
  if (!['openai', 'anthropic', 'google', 'openrouter'].includes(provider)) {
    throw new ApiError(409, 'CONFLICT', 'Active AI provider is not supported')
  }
  return provider
}

export async function runOrgAiCompletion(
  db: DatabaseClient,
  orgId: string,
  promptKey: AiPromptKey,
  userContent: string,
): Promise<AiCompletionResult & { promptVersion: string; prompt: string }> {
  const { data, error } = await db.rpc('get_ai_org_prompts', { p_org_id: orgId })
  if (error) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not load AI prompts')
  }
  const overrides = data && typeof data === 'object' && !Array.isArray(data)
    ? ((data as Record<string, unknown>).overrides as Record<string, unknown> | undefined)
    : undefined
  const prompt = mergeEffectivePrompts(overrides)[promptKey]
  const promptVersion = await promptVersionFor(prompt)

  const provider = await resolveActiveAiProvider(db, orgId)

  const service = serviceRoleClient()
  const { data: creds, error: credError } = await service.rpc('read_ai_integration_credentials', {
    p_org_id: orgId,
    p_provider: provider,
  })
  if (credError) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not read AI credentials')
  }
  const apiKey = creds && typeof creds === 'object' && !Array.isArray(creds)
    ? (creds as Record<string, unknown>).api_key
    : null
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new ApiError(409, 'CONFLICT', 'AI integration credentials are unavailable')
  }

  const completion = await completeAiPrompt({
    provider,
    apiKey,
    systemPrompt: prompt,
    userContent,
  })
  return { ...completion, prompt, promptVersion }
}
