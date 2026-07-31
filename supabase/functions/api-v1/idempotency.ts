import { ApiError } from './http.ts'

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
const MAX_KEY_LENGTH = 256

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
