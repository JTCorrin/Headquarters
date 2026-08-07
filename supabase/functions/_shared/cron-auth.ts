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
 * Require a configured env secret and a matching request header.
 * Missing configuration → 503 (fail closed). Wrong/missing header → 401.
 */
export function authorizeCronRequest(
  req: Request,
  options: {
    envSecret: string | undefined
    headerName: string
    missingConfigLog?: string
  },
): CronAuthResult {
  const expected = options.envSecret?.trim() ?? ''
  if (!expected) {
    if (options.missingConfigLog) {
      console.error(options.missingConfigLog)
    }
    return { ok: false, status: 503, error: 'SERVICE_UNAVAILABLE' }
  }
  const supplied = req.headers.get(options.headerName) ?? ''
  if (!timingSafeEqual(supplied, expected)) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED' }
  }
  return { ok: true }
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
