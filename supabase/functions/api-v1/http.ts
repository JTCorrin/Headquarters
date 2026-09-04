export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'ORG_CONTEXT_REQUIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'PRECONDITION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED'
  | 'UPSTREAM_ERROR'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
  }
}

export function apiPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/api/v1' || path.startsWith('/api/v1/')) {
    return path
  }

  for (const prefix of ['/functions/v1/api-v1', '/api-v1']) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      const suffix = path.slice(prefix.length)
      if (suffix === '/api/v1' || suffix.startsWith('/api/v1/')) return suffix
      return `/api/v1${suffix}`
    }
  }

  return path
}

export function jsonResponse(
  data: unknown,
  status: number,
  requestId: string,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  responseHeaders.set('x-request-id', requestId)
  return new Response(JSON.stringify(data), { status, headers: responseHeaders })
}

export function errorResponse(error: ApiError, requestId: string): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        request_id: requestId,
      },
    },
    error.status,
    requestId,
  )
}

export function parseUuid(value: string | null, field: string): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApiError(400, 'BAD_REQUEST', `${field} must be a UUID`, {
      [field]: 'Must be a UUID',
    })
  }
  return value
}

export function parseLimit(
  value: string | null,
  options: { max?: number; fallback?: number } = {},
): number {
  const max = options.max ?? 200
  const fallback = options.fallback ?? 50
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'limit must be an integer', {
      limit: `Must be an integer between 1 and ${max}`,
    })
  }

  const limit = Number(value)
  if (limit < 1 || limit > max) {
    throw new ApiError(400, 'BAD_REQUEST', 'limit is out of range', {
      limit: `Must be between 1 and ${max}`,
    })
  }
  return limit
}

export function requireJson(req: Request): void {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  }
}

/** Default JSON body cap. Transcript attach may raise this (plain_text up to 500k chars). */
export const DEFAULT_JSON_BODY_MAX_BYTES = 65_536
/** Enough for meeting transcript plain_text (schema max 500_000 chars) + envelope. */
export const TRANSCRIPT_JSON_BODY_MAX_BYTES = 600_000

export async function jsonBody(
  req: Request,
  options: { maxBytes?: number } = {},
): Promise<Record<string, unknown>> {
  requireJson(req)

  const maxBytes = options.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES
  const declaredLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      maxBytes === DEFAULT_JSON_BODY_MAX_BYTES
        ? 'Request body exceeds 64 KiB'
        : `Request body exceeds ${maxBytes} bytes`,
    )
  }

  const body = await req.text()
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      maxBytes === DEFAULT_JSON_BODY_MAX_BYTES
        ? 'Request body exceeds 64 KiB'
        : `Request body exceeds ${maxBytes} bytes`,
    )
  }

  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request body is not valid JSON')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

export function parseVersion(req: Request): number {
  const header = req.headers.get('if-match')
  const match = header?.match(/^"(\d+)"$/)
  if (!match) {
    throw new ApiError(
      428,
      'PRECONDITION_REQUIRED',
      'If-Match with the current numeric version is required',
    )
  }

  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApiError(400, 'BAD_REQUEST', 'If-Match version is invalid')
  }
  return version
}

export function etag(version: number): string {
  return `"${version}"`
}

/** Strict ISO-8601 instant with a real calendar date (rejects Date.parse normalization). */
export function isStrictIsoTimestamp(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/,
  )
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false
  }

  // Reject impossible calendar dates (Date.parse would normalize 2026-02-31).
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    !Number.isNaN(Date.parse(value))
  )
}
