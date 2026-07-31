import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { validateClientBody } from './clients.ts'
import { decodeCursor, validateContactBody } from './contacts.ts'
import {
  ApiError,
  apiPath,
  isStrictIsoTimestamp,
  jsonBody,
  parseLimit,
  parseVersion,
} from './http.ts'
import { validateLeadBody } from './leads.ts'
import { hashIdempotencyRequest, parseIdempotencyKey } from './idempotency.ts'
import {
  validateOrganisationConfigurationBody,
  validateOrganisationCreateBody,
} from './organisations.ts'
import { decodeProductCategoryCursor, validateProductCategoryBody } from './product-categories.ts'
import { decodeProductCursor, validateAdjustStockBody, validateProductBody } from './products.ts'
import { validateProfilePreferencesBody } from './profile-preferences.ts'
import { assertJsonSafeLineMoney, decodeQuoteCursor, validateQuoteBody } from './quotes.ts'
import { validateTaxRateBody } from './tax-rates.ts'

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
  assertEquals(
    validateLeadBody(
      { name: 'USD org lead' },
      false,
      { defaultCurrency: 'USD' },
    ).currency,
    'USD',
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

Deno.test('lead validation rejects unsafe integers and impossible dates', () => {
  assertThrows(
    () =>
      validateLeadBody(
        { name: 'Overflow', value_cents: Number.MAX_SAFE_INTEGER + 1 },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateLeadBody(
        { name: 'Bad date', expected_close_on: '2026-02-31' },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateLeadBody(
        { name: 'Bad probability', probability_percent: 12.345 },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateLeadBody(
        { name: 'Position overflow', position: 10_000_000_000 },
        false,
      ),
    ApiError,
  )
  assertEquals(
    validateLeadBody({ name: 'Position ok', position: 12345.6789012345 }, false).position,
    12345.6789012345,
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

Deno.test('product category create validation trims name and bounds position', () => {
  assertEquals(
    validateProductCategoryBody({ name: '  Widgets  ', description: 'Parts' }, false),
    {
      name: 'Widgets',
      description: 'Parts',
      position: 0,
    },
  )
  assertThrows(
    () => validateProductCategoryBody({ name: 'Bad', position: 10_000_000_000 }, false),
    ApiError,
  )
})

Deno.test('product create validation defaults and rejects stock writes / service tracking', () => {
  assertEquals(
    validateProductBody(
      { sku: ' SKU-1 ', name: ' Widget ', unit_price_cents: 1250 },
      false,
    ),
    {
      sku: 'SKU-1',
      name: 'Widget',
      product_type: 'product',
      unit_price_cents: 1250,
      currency: 'GBP',
      track_stock: false,
      status: 'active',
    },
  )
  assertEquals(
    validateProductBody(
      { sku: 'SKU-USD', name: 'Widget', unit_price_cents: 100 },
      false,
      { defaultCurrency: 'USD' },
    ).currency,
    'USD',
  )
  assertEquals(
    validateProductBody(
      { sku: 'SKU-EUR', name: 'Widget', unit_price_cents: 100, currency: 'EUR' },
      false,
      { defaultCurrency: 'USD' },
    ).currency,
    'EUR',
  )
  assertThrows(
    () =>
      validateProductBody(
        { sku: 'S1', name: 'Svc', product_type: 'service', unit_price_cents: 1, track_stock: true },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateProductBody(
        { sku: 'S1', name: 'Widget', unit_price_cents: 1, stock_qty: 5 },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateProductBody(
        { sku: 'S1', name: 'Widget', unit_price_cents: Number.MAX_SAFE_INTEGER + 1 },
        false,
      ),
    ApiError,
  )
})

Deno.test('stock adjustment validation bounds quantity_delta', () => {
  assertEquals(
    validateAdjustStockBody({ quantity_delta: -3.5, reason: 'adjustment' }),
    { quantity_delta: -3.5, reason: 'adjustment' },
  )
  assertThrows(() => validateAdjustStockBody({ quantity_delta: 0 }), ApiError)
  assertThrows(() => validateAdjustStockBody({ quantity_delta: 10_000_000_000 }), ApiError)
  assertThrows(() => validateAdjustStockBody({ quantity_delta: 1.00001 }), ApiError)
  assertEquals(
    validateAdjustStockBody({
      quantity_delta: 1,
      reason: 'adjustment',
      occurred_at: '2026-07-31T12:00:00Z',
    }),
    {
      quantity_delta: 1,
      reason: 'adjustment',
      occurred_at: '2026-07-31T12:00:00Z',
    },
  )
  assertThrows(
    () =>
      validateAdjustStockBody({
        quantity_delta: 1,
        occurred_at: '2026-07-31',
      }),
    ApiError,
  )
  assertThrows(
    () =>
      validateAdjustStockBody({
        quantity_delta: 1,
        occurred_at: '2026-02-31T12:00:00Z',
      }),
    ApiError,
  )
})

Deno.test('catalog cursors require strict ISO-8601 timestamps', () => {
  const encode = (createdAt: string) =>
    btoa(JSON.stringify({
      created_at: createdAt,
      id: '52e1a71a-1c93-4ec8-a566-e0eecaf06747',
    }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')

  assertEquals(
    decodeProductCursor(encode('2026-07-31T12:00:00.123456Z')).created_at,
    '2026-07-31T12:00:00.123456Z',
  )
  assertEquals(
    decodeProductCategoryCursor(encode('2026-07-31T12:00:00+00:00')).created_at,
    '2026-07-31T12:00:00+00:00',
  )
  assertEquals(isStrictIsoTimestamp('2026-02-31T12:00:00Z'), false)
  assertThrows(() => decodeProductCursor(encode('2026-02-31T12:00:00Z')), ApiError)
  assertThrows(() => decodeProductCursor(encode('2026-07-31 12:00:00')), ApiError)
  assertThrows(() => decodeProductCategoryCursor(encode('July 31, 2026')), ApiError)
})

Deno.test('Idempotency-Key parsing and request hashing', async () => {
  assertEquals(
    parseIdempotencyKey(
      new Request('https://example.test', { headers: { 'idempotency-key': 'adj-1' } }),
    ),
    'adj-1',
  )
  assertThrows(
    () => parseIdempotencyKey(new Request('https://example.test')),
    ApiError,
  )
  const a = await hashIdempotencyRequest('/api/v1/products/x/adjust-stock', {
    quantity_delta: 1,
  })
  const b = await hashIdempotencyRequest('/api/v1/products/x/adjust-stock', {
    quantity_delta: 2,
  })
  assertEquals(a.length, 64)
  assertEquals(a === b, false)
})

Deno.test('organisation create and configuration validation', () => {
  assertEquals(
    validateOrganisationCreateBody({
      name: '  Corrin Data  ',
      slug: 'corrin-data',
      country_code: 'gb',
      timezone: 'Europe/London',
    }),
    {
      name: 'Corrin Data',
      slug: 'corrin-data',
      country_code: 'GB',
      default_currency: 'GBP',
      timezone: 'Europe/London',
      locale: 'en-GB',
    },
  )
  assertThrows(
    () =>
      validateOrganisationCreateBody({
        name: 'Bad',
        slug: 'Bad Slug',
        country_code: 'GB',
      }),
    ApiError,
  )
  assertThrows(
    () =>
      validateOrganisationCreateBody({
        name: 'Bad',
        slug: 'ok-slug',
        country_code: 'GB',
        timezone: 'Not/A_Zone',
      }),
    ApiError,
  )
  assertEquals(
    validateOrganisationConfigurationBody({ theme_default: 'dark', default_currency: 'USD' }),
    { theme_default: 'dark', default_currency: 'USD' },
  )
  assertThrows(
    () => validateOrganisationConfigurationBody({ theme_default: 'neon' }),
    ApiError,
  )
  assertThrows(
    () => validateOrganisationConfigurationBody({ org_id: 'x' }),
    ApiError,
  )
})

Deno.test('quote create validation defaults currency and rejects calculated fields', () => {
  const productId = '11111111-1111-4111-8111-111111111111'
  const clientId = '22222222-2222-4222-8222-222222222222'
  assertEquals(
    validateQuoteBody(
      {
        title: '  Q2 retainer  ',
        client_id: clientId,
        lines: [
          {
            product_id: productId,
            quantity: 2,
            unit_price_cents: 10000,
            tax_rate_percent: 20,
          },
        ],
      },
      false,
      { defaultCurrency: 'USD' },
    ),
    {
      title: 'Q2 retainer',
      client_id: clientId,
      currency: 'USD',
      lines: [
        {
          product_id: productId,
          quantity: 2,
          unit_price_cents: 10000,
          discount_percent: 0,
          tax_rate_percent: 20,
        },
      ],
    },
  )
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: 'Missing party',
          lines: [],
        },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: 'Bad',
          client_id: clientId,
          status: 'sent',
          lines: [],
        },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: 'Bad totals',
          client_id: clientId,
          total_cents: 1,
          lines: [],
        },
        false,
      ),
    ApiError,
  )
  assertEquals(
    validateQuoteBody(
      {
        title: 'Patch title',
        discount_cents: 100,
      },
      true,
    ),
    { title: 'Patch title', discount_cents: 100 },
  )
  assertThrows(() => validateQuoteBody({}, true), ApiError)
  assertThrows(
    () =>
      decodeQuoteCursor(
        btoa(JSON.stringify({ created_at: 'not-a-date', id: clientId }))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replace(/=+$/, ''),
      ),
    ApiError,
  )
})

Deno.test('quote line money rejects JSON-unsafe quantity × price products', () => {
  const clientId = '22222222-2222-4222-8222-222222222222'
  assertEquals(assertJsonSafeLineMoney(2, 10000), true)
  assertEquals(assertJsonSafeLineMoney(2, Number.MAX_SAFE_INTEGER), false)
  assertEquals(
    assertJsonSafeLineMoney(Number.MAX_SAFE_INTEGER, 1),
    true,
  )
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: 'Overflow',
          client_id: clientId,
          lines: [
            {
              description: 'Huge',
              quantity: 2,
              unit_price_cents: Number.MAX_SAFE_INTEGER,
            },
          ],
        },
        false,
      ),
    ApiError,
  )
})

Deno.test('tax rate and profile preference validation', () => {
  assertEquals(
    validateTaxRateBody({ name: 'VAT', rate_percent: 20, is_default: true }, false),
    { name: 'VAT', rate_percent: 20, is_default: true, active: true },
  )
  assertThrows(
    () => validateTaxRateBody({ name: 'Bad', rate_percent: Number.NaN }, false),
    ApiError,
  )
  assertThrows(
    () => validateTaxRateBody({ name: 'Bad', rate_percent: 20, org_id: 'x' }, false),
    ApiError,
  )
  assertThrows(() => validateTaxRateBody({}, true), ApiError)
  assertEquals(
    validateTaxRateBody({ name: 'Renamed' }, true),
    { name: 'Renamed' },
  )
  assertEquals(
    validateProfilePreferencesBody({ theme_preference: null }),
    { theme_preference: null },
  )
  assertThrows(
    () => validateProfilePreferencesBody({ theme_preference: 'neon' }),
    ApiError,
  )
})
