/**
 * Shared fail-closed auth for verify_jwt=false cron Edge entrypoints.
 */

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  let diff = 0
  for (let i = 0; i < bufA.byteLength; i++) diff |= bufA[i]! ^ bufB[i]!
  return diff === 0
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * Require a configured cron secret header, or a service-role Bearer token.
 *
 * Hosted pg_cron callers typically send `Authorization: Bearer <service_role>`
 * (platform-injected into Edge). Self-hosted/staging cron wrappers send the
 * dedicated header secret instead.
 *
 * Missing both configurations → 503 (fail closed). Wrong credentials → 401.
 */
export function authorizeCronRequest(
  req: Request,
  options: {
    envSecret: string | undefined
    headerName: string
    serviceRoleKey?: string | undefined
    missingConfigLog?: string
  },
): CronAuthResult {
  const expected = options.envSecret?.trim() ?? ''
  const serviceRole = options.serviceRoleKey?.trim() ?? ''
  if (!expected && !serviceRole) {
    if (options.missingConfigLog) {
      console.error(options.missingConfigLog)
    }
    return { ok: false, status: 503, error: 'SERVICE_UNAVAILABLE' }
  }

  if (expected) {
    const supplied = req.headers.get(options.headerName) ?? ''
    if (timingSafeEqual(supplied, expected)) {
      return { ok: true }
    }
  }

  if (serviceRole) {
    const authorization = req.headers.get('Authorization') ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    const token = match?.[1]?.trim() ?? ''
    if (token && timingSafeEqual(token, serviceRole)) {
      return { ok: true }
    }
  }

  return { ok: false, status: 401, error: 'UNAUTHORIZED' }
}

/** Bearer token shape used by the api-v1 production router to pick JWT vs API-key path. */
export function routerAuthMode(
  authorizationHeader: string | null,
): 'api_key' | 'user' {
  if (!authorizationHeader) return 'user'
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  const token = match?.[1]?.trim() ?? ''
  // Keep in sync with isOrgApiKeySecret in api-keys.ts.
  if (/^crm_key_[0-9a-f]{32}$/i.test(token)) return 'api_key'
  return 'user'
}
