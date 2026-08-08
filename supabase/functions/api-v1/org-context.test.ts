import { assertEquals, assertThrows } from '@std/assert'
import { ApiError } from './http.ts'
import {
  API_V1_CORS_ALLOW_HEADERS,
  buildApiV1CorsHeaders,
  resolveApiKeyOrgId,
} from './org-context.ts'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'

Deno.test('resolveApiKeyOrgId uses pinned org when header omitted', () => {
  assertEquals(resolveApiKeyOrgId(null, ORG_A), ORG_A)
})

Deno.test('resolveApiKeyOrgId accepts matching X-Org-Id', () => {
  assertEquals(resolveApiKeyOrgId(ORG_A, ORG_A), ORG_A)
})

Deno.test('resolveApiKeyOrgId rejects mismatched X-Org-Id', () => {
  const err = assertThrows(
    () => resolveApiKeyOrgId(ORG_B, ORG_A),
    ApiError,
  )
  assertEquals(err.status, 403)
  assertEquals(err.code, 'FORBIDDEN')
})

Deno.test('buildApiV1CorsHeaders defaults origin and includes x-org-id', () => {
  const headers = buildApiV1CorsHeaders(undefined)
  assertEquals(headers['Access-Control-Allow-Origin'], '*')
  assertEquals(
    API_V1_CORS_ALLOW_HEADERS.includes('x-org-id'),
    true,
  )
  assertEquals(
    headers['Access-Control-Allow-Headers']?.includes('x-org-id'),
    true,
  )
})

Deno.test('buildApiV1CorsHeaders respects configured origin', () => {
  const headers = buildApiV1CorsHeaders('https://crm.example.test')
  assertEquals(headers['Access-Control-Allow-Origin'], 'https://crm.example.test')
})
