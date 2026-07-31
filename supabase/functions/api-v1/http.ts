export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'ORG_CONTEXT_REQUIRED'
  | 'PRECONDITION_REQUIRED'
  | 'UNAUTHENTICATED'
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
  const productApiIndex = pathname.indexOf('/api/v1')
  if (productApiIndex >= 0) {
    return pathname.slice(productApiIndex).replace(/\/+$/, '') || '/api/v1'
  }

  const functionIndex = pathname.indexOf('/api-v1')
  if (functionIndex >= 0) {
    const suffix = pathname.slice(functionIndex + '/api-v1'.length).replace(/\/+$/, '')
    return `/api/v1${suffix}`
  }

  return pathname.replace(/\/+$/, '') || '/'
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

export function parseLimit(value: string | null): number {
  if (value === null) return 50
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'limit must be an integer', {
      limit: 'Must be an integer between 1 and 200',
    })
  }

  const limit = Number(value)
  if (limit < 1 || limit > 200) {
    throw new ApiError(400, 'BAD_REQUEST', 'limit is out of range', {
      limit: 'Must be between 1 and 200',
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

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  requireJson(req)

  let value: unknown
  try {
    value = await req.json()
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
  const match = header?.match(/^(?:W\/)?"?(\d+)"?$/)
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
