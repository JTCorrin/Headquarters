import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import { ApiError } from './http.ts'

type DatabaseClient = SupabaseClient<Database>

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
const MAX_KEY_LENGTH = 256
const TTL_MS = 24 * 60 * 60 * 1000

export interface IdempotentReplay {
  status: number
  body: unknown
  headers: Record<string, string>
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function parseIdempotencyKey(req: Request): string {
  const key = req.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim() ?? ''
  if (!key || key.length > MAX_KEY_LENGTH || !/^[\x21-\x7E]+$/.test(key)) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'Idempotency-Key is required for this command',
      {
        [IDEMPOTENCY_KEY_HEADER]: 'Must be a printable ASCII string between 1 and 256 characters',
      },
    )
  }
  return key
}

export async function hashIdempotencyRequest(
  route: string,
  payload: Record<string, unknown>,
): Promise<string> {
  return await sha256Hex(JSON.stringify({ route, payload }))
}

function parseStoredBody(value: Json | null): IdempotentReplay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as { body?: unknown; headers?: Record<string, string>; status?: number }
  if (typeof record.status !== 'number' || !('body' in record)) return null
  return {
    status: record.status,
    body: record.body,
    headers: record.headers && typeof record.headers === 'object' ? record.headers : {},
  }
}

export async function beginIdempotentCommand(
  db: DatabaseClient,
  orgId: string,
  userId: string,
  route: string,
  rawKey: string,
  requestHash: string,
): Promise<{ replay: IdempotentReplay | null; keyHash: string }> {
  const keyHash = await sha256Hex(rawKey)
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()

  const { data: existing, error: lookupError } = await db
    .from('api_idempotency_keys')
    .select('request_hash, response_status, response_body')
    .eq('org_id', orgId)
    .eq('actor_type', 'user')
    .eq('actor_id', userId)
    .eq('idempotency_key_hash', keyHash)
    .maybeSingle()

  if (lookupError) {
    console.error('Idempotency lookup failed', { code: lookupError.code })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Idempotency lookup failed')
  }

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ApiError(
        409,
        'CONFLICT',
        'Idempotency-Key was reused with a different request payload',
      )
    }
    const replay = parseStoredBody(existing.response_body)
    if (existing.response_status != null && replay) {
      return { keyHash, replay: { ...replay, status: existing.response_status } }
    }
    throw new ApiError(409, 'CONFLICT', 'An identical request is already in progress')
  }

  const { error: insertError } = await db.from('api_idempotency_keys').insert({
    org_id: orgId,
    actor_type: 'user',
    actor_id: userId,
    idempotency_key_hash: keyHash,
    route,
    request_hash: requestHash,
    expires_at: expiresAt,
  })

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: raced, error: raceError } = await db
        .from('api_idempotency_keys')
        .select('request_hash, response_status, response_body')
        .eq('org_id', orgId)
        .eq('actor_type', 'user')
        .eq('actor_id', userId)
        .eq('idempotency_key_hash', keyHash)
        .maybeSingle()
      if (raceError || !raced) {
        throw new ApiError(500, 'INTERNAL_ERROR', 'Idempotency race recovery failed')
      }
      if (raced.request_hash !== requestHash) {
        throw new ApiError(
          409,
          'CONFLICT',
          'Idempotency-Key was reused with a different request payload',
        )
      }
      const replay = parseStoredBody(raced.response_body)
      if (raced.response_status != null && replay) {
        return { keyHash, replay: { ...replay, status: raced.response_status } }
      }
      throw new ApiError(409, 'CONFLICT', 'An identical request is already in progress')
    }
    console.error('Idempotency claim failed', { code: insertError.code })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Idempotency claim failed')
  }

  return { replay: null, keyHash }
}

export async function completeIdempotentCommand(
  db: DatabaseClient,
  orgId: string,
  userId: string,
  keyHash: string,
  replay: IdempotentReplay,
  resourceType?: string,
  resourceId?: string,
): Promise<void> {
  const { error } = await db
    .from('api_idempotency_keys')
    .update({
      response_status: replay.status,
      response_body: {
        status: replay.status,
        body: replay.body as Json,
        headers: replay.headers,
      } as Json,
      resource_type: resourceType ?? null,
      resource_id: resourceId ?? null,
    })
    .eq('org_id', orgId)
    .eq('actor_type', 'user')
    .eq('actor_id', userId)
    .eq('idempotency_key_hash', keyHash)

  if (error) {
    console.error('Idempotency completion failed', { code: error.code })
    throw new ApiError(500, 'INTERNAL_ERROR', 'Idempotency completion failed')
  }
}
