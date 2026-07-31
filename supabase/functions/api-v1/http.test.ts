import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { validateClientBody } from './clients.ts'
import { decodeCursor, validateContactBody } from './contacts.ts'
import { ApiError, apiPath, jsonBody, parseLimit, parseVersion } from './http.ts'
import { validateLeadBody } from './leads.ts'

Deno.test('apiPath normalises product and native function URLs', () => {
  assertEquals(apiPath('/api/v1/contacts'), '/api/v1/contacts')
  assertEquals(
    apiPath('/functions/v1/api-v1/api/v1/contacts/'),
    '/api/v1/contacts',
  )
  assertEquals(apiPath('/functions/v1/api-v1/contacts/'), '/api/v1/contacts')
  assertEquals(apiPath('/tenant/api/v1/contacts'), '/tenant/api/v1/contacts')
})

Deno.test('parseLimit applies defaults and bounds', () => {
  assertEquals(parseLimit(null), 50)
  assertEquals(parseLimit('200'), 200)
  assertThrows(() => parseLimit('0'), ApiError)
  assertThrows(() => parseLimit('1.5'), ApiError)
  assertThrows(() => parseLimit('201'), ApiError)
})

Deno.test('parseVersion accepts numeric ETags and requires a precondition', () => {
  assertEquals(
    parseVersion(new Request('https://example.test', { headers: { 'if-match': '"7"' } })),
    7,
  )
  assertThrows(
    () => parseVersion(new Request('https://example.test', { headers: { 'if-match': 'W/"8"' } })),
    ApiError,
  )
  assertThrows(() => parseVersion(new Request('https://example.test')), ApiError)
})

Deno.test('jsonBody rejects oversized payloads', async () => {
  await assertRejects(
    () =>
      jsonBody(
        new Request('https://example.test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: 'x'.repeat(65_536) }),
        }),
      ),
    ApiError,
  )
})

Deno.test('contact create validation strips whitespace and supplies lifecycle status', () => {
  assertEquals(
    validateContactBody(
      {
        display_name: '  Ada Lovelace  ',
        primary_email: 'ada@example.test',
        metadata: { source_id: 'import-1' },
      },
      false,
    ),
    {
      display_name: 'Ada Lovelace',
      primary_email: 'ada@example.test',
      lifecycle_status: 'active',
      metadata: { source_id: 'import-1' },
    },
  )
})

Deno.test('contact validation rejects tenancy and invalid lifecycle fields', () => {
  assertThrows(
    () =>
      validateContactBody(
        {
          display_name: 'Ada',
          org_id: '52e1a71a-1c93-4ec8-a566-e0eecaf06747',
          lifecycle_status: 'lead',
        },
        false,
      ),
    ApiError,
  )
})

Deno.test('contact cursors reject untrusted values', () => {
  assertThrows(() => decodeCursor('not-base64'), ApiError)
  assertThrows(
    () =>
      decodeCursor(
        btoa(
          JSON.stringify({
            created_at: 'not-a-date',
            id: '52e1a71a-1c93-4ec8-a566-e0eecaf06747',
          }),
        ),
      ),
    ApiError,
  )
})

Deno.test('lead create validation defaults stage and currency', () => {
  assertEquals(
    validateLeadBody(
      {
        name: '  Acme Opportunity  ',
        company_name: 'Acme Ltd',
        value_cents: 125000,
      },
      false,
    ),
    {
      name: 'Acme Opportunity',
      company_name: 'Acme Ltd',
      value_cents: 125000,
      stage: 'new',
      currency: 'GBP',
      position: 0,
    },
  )
})

Deno.test('lead validation rejects direct won stage and requires lost_reason', () => {
  assertThrows(
    () => validateLeadBody({ name: 'Won deal', stage: 'won' }, false),
    ApiError,
  )
  assertThrows(
    () => validateLeadBody({ name: 'Lost deal', stage: 'lost' }, false),
    ApiError,
  )
  assertEquals(
    validateLeadBody(
      { name: 'Lost deal', stage: 'lost', lost_reason: 'No budget' },
      false,
    ).lost_reason,
    'No budget',
  )
})

Deno.test('client create validation defaults status and rejects conversion fields', () => {
  assertEquals(
    validateClientBody({ name: '  Acme Ltd  ', primary_email: 'billing@acme.test' }, false),
    {
      name: 'Acme Ltd',
      primary_email: 'billing@acme.test',
      status: 'active',
    },
  )
  assertThrows(
    () =>
      validateClientBody(
        {
          name: 'Acme Ltd',
          converted_from_lead_id: '52e1a71a-1c93-4ec8-a566-e0eecaf06747',
        },
        false,
      ),
    ApiError,
  )
})
