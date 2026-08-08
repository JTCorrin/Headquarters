import { ApiError, parseUuid } from './http.ts'

/**
 * API-key org pinning: optional X-Org-Id must match the key's organisation.
 * Returns the org id to use for the request.
 */
export function resolveApiKeyOrgId(
  orgHeader: string | null,
  pinnedOrgId: string,
): string {
  if (!orgHeader) return pinnedOrgId
  const headerOrg = parseUuid(orgHeader, 'x-org-id')
  if (headerOrg !== pinnedOrgId) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'X-Org-Id does not match the organisation pinned on this API key',
    )
  }
  return pinnedOrgId
}

/** CORS allow-list for api-v1 (must stay aligned with index.ts corsHeaders). */
export const API_V1_CORS_ALLOW_HEADERS = [
  'authorization',
  'apikey',
  'content-type',
  'if-match',
  'idempotency-key',
  'x-client-info',
  'x-org-id',
  'x-request-id',
  'mcp-protocol-version',
  'mcp-method',
  'mcp-name',
] as const

export function buildApiV1CorsHeaders(
  configuredOrigin: string | undefined,
): Record<string, string> {
  const origin = configuredOrigin?.trim() || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': API_V1_CORS_ALLOW_HEADERS.join(', '),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'etag, location, x-request-id',
  }
}
