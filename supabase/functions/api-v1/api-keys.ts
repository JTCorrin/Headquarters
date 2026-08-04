import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { ApiError, jsonBody, jsonResponse, parseUuid } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

const API_KEY_ROLES = new Set<MembershipRole>([
  'owner',
  'admin',
  'member',
  'billing',
  'readonly',
])

export type ApiKeyPublic = {
  id: string
  org_id: string
  name: string
  prefix: string
  role: MembershipRole
  scopes: string[]
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  created_by: string | null
}

export type ApiKeyCreateResult = ApiKeyPublic & { secret: string }

export type ResolvedApiKey = {
  id: string
  org_id: string
  name: string
  prefix: string
  role: MembershipRole
  scopes: string[]
  expires_at: string | null
  created_by: string | null
}

function assertCanManageApiKeys(role: MembershipRole): void {
  if (role !== 'owner' && role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only owners and admins can manage API keys')
  }
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === '42501' || message.includes('forbidden')) {
    return new ApiError(403, 'FORBIDDEN', error.message ?? 'API key operation is forbidden')
  }
  if (error.code === 'P0002' || message.includes('not found')) {
    return new ApiError(404, 'NOT_FOUND', 'API key not found')
  }
  if (error.code === '22023' || message.includes('invalid')) {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'API key validation failed')
  }
  console.error('API key operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The API key operation failed')
}

function assertNoSecretEcho(payload: unknown): void {
  const text = JSON.stringify(payload)
  if (/"key_hash"\s*:/.test(text)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'API key response contained a forbidden secret field')
  }
}

export function validateApiKeyCreateBody(body: Record<string, unknown>): {
  name: string
  role: MembershipRole
  expires_at: string | null
} {
  const fields: Record<string, string> = {}
  const writable = new Set(['name', 'role', 'expires_at'])
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Unknown field'
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) {
    fields.name = 'Must be a non-empty string up to 120 characters'
  }

  let role: MembershipRole = 'member'
  if ('role' in body) {
    if (typeof body.role !== 'string' || !API_KEY_ROLES.has(body.role as MembershipRole)) {
      fields.role = 'Must be owner, admin, member, billing, or readonly'
    } else {
      role = body.role as MembershipRole
    }
  }

  let expiresAt: string | null = null
  if ('expires_at' in body && body.expires_at !== null) {
    if (typeof body.expires_at !== 'string' || Number.isNaN(Date.parse(body.expires_at))) {
      fields.expires_at = 'Must be an ISO-8601 timestamp or null'
    } else {
      expiresAt = new Date(body.expires_at).toISOString()
      if (Date.parse(expiresAt) <= Date.now()) {
        fields.expires_at = 'Must be in the future'
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'API key validation failed', fields)
  }

  return { name, role, expires_at: expiresAt }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(\S+)\s*$/i)
  return match?.[1] ?? null
}

export function isOrgApiKeySecret(token: string): boolean {
  return /^crm_key_[0-9a-f]{32}$/i.test(token)
}

function serviceRoleClient(): SupabaseClient<Database> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Service credentials are unavailable')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function resolveOrgApiKey(secret: string): Promise<ResolvedApiKey> {
  if (!isOrgApiKeySecret(secret)) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid API key')
  }
  const hash = await sha256Hex(secret)
  const admin = serviceRoleClient()
  const { data, error } = await admin.rpc('resolve_api_key_by_hash', { p_key_hash: hash })
  if (error) {
    console.error('API key resolve failed', { code: error.code })
    throw new ApiError(500, 'INTERNAL_ERROR', 'API key authentication failed')
  }
  if (!data || typeof data !== 'object') {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid API key')
  }
  const row = data as Record<string, unknown>
  const role = row.role
  if (
    typeof row.id !== 'string' ||
    typeof row.org_id !== 'string' ||
    typeof role !== 'string' ||
    !API_KEY_ROLES.has(role as MembershipRole)
  ) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid API key')
  }

  // Fire-and-forget last_used; auth must not fail if touch races.
  void admin.rpc('touch_api_key_last_used', { p_key_id: row.id }).then(({ error: touchError }) => {
    if (touchError) {
      console.error('API key last_used touch failed', { code: touchError.code })
    }
  })

  return {
    id: row.id,
    org_id: row.org_id,
    name: typeof row.name === 'string' ? row.name : '',
    prefix: typeof row.prefix === 'string' ? row.prefix : '',
    role: role as MembershipRole,
    scopes: Array.isArray(row.scopes)
      ? row.scopes.filter((s): s is string => typeof s === 'string')
      : [],
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
  }
}

export function serviceRoleDb(): SupabaseClient<Database> {
  return serviceRoleClient()
}

async function listApiKeys(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('list_org_api_keys', { p_org_id: orgId })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data: data ?? [] }, 200, requestId)
}

async function createApiKey(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const body = await jsonBody(req)
  const input = validateApiKeyCreateBody(body)
  const { data, error } = await db.rpc('create_org_api_key', {
    p_org_id: orgId,
    p_name: input.name,
    p_role: input.role,
    p_expires_at: input.expires_at,
  })
  if (error) throw databaseError(error, requestId)
  const created = data as ApiKeyCreateResult | null
  if (!created || typeof created.secret !== 'string') {
    throw new ApiError(500, 'INTERNAL_ERROR', 'API key create did not return a secret')
  }
  // Secret is intentional on create only — do not treat as echo leak.
  const { secret: _secret, ...safeCheck } = created
  assertNoSecretEcho(safeCheck)
  return jsonResponse({ data: created }, 201, requestId)
}

async function revokeApiKey(
  db: DatabaseClient,
  orgId: string,
  keyId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db.rpc('revoke_org_api_key', {
    p_org_id: orgId,
    p_key_id: keyId,
  })
  if (error) throw databaseError(error, requestId)
  assertNoSecretEcho(data)
  return jsonResponse({ data }, 200, requestId)
}

export async function handleApiKeys(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRole,
  requestId: string,
): Promise<Response> {
  assertCanManageApiKeys(role)

  if (path === '/api/v1/api-keys') {
    if (req.method === 'GET') return await listApiKeys(db, orgId, requestId)
    if (req.method === 'POST') return await createApiKey(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for API keys')
  }

  const match = path.match(
    /^\/api\/v1\/api-keys\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (match) {
    const keyId = parseUuid(match[1], 'id')
    if (req.method === 'DELETE') return await revokeApiKey(db, orgId, keyId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for API key')
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}
