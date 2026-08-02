import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { validateClientBody } from './clients.ts'
import { decodeCursor, extractContactClientId, validateContactBody } from './contacts.ts'
import { validateFolderCreateBody, validateUploadIntentBody } from './documents.ts'
import {
  ApiError,
  apiPath,
  isStrictIsoTimestamp,
  jsonBody,
  parseLimit,
  parseVersion,
} from './http.ts'
import { validateDecideBody, validateGenerateBody } from './ai-suggestions.ts'
import { validateShareBody } from './email-messages.ts'
import {
  parseAiProvider,
  payloadHasForbiddenSecretKey,
  validateAiConnectBody,
} from './integrations.ts'
import { validateMailboxBody, validateMailboxTestBody } from './mailbox.ts'
import { resolveLeadCurrency, validateLeadBody } from './leads.ts'
import { hashIdempotencyRequest, parseIdempotencyKey } from './idempotency.ts'
import { decodeInvoiceCursor, validateInvoiceBody } from './invoices.ts'
import { validateBillBody } from './bills.ts'
import { validateVendorBody } from './vendors.ts'
import { decodeTaskCursor, validateTaskBody } from './tasks.ts'
import {
  recurringLifecycleIdempotencyPayload,
  validateRecurringScheduleBody,
} from './recurring-invoices.ts'
import {
  validateOrganisationConfigurationBody,
  validateOrganisationCreateBody,
} from './organisations.ts'
import { decodeProductCategoryCursor, validateProductCategoryBody } from './product-categories.ts'
import { decodeProductCursor, validateAdjustStockBody, validateProductBody } from './products.ts'
import { validateProfilePreferencesBody } from './profile-preferences.ts'
import {
  assertJsonSafeLineMoney,
  decodeQuoteCursor,
  parseQuoteListStatus,
  validateQuoteBody,
} from './quotes.ts'
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

Deno.test('contact client_id is a virtual field extracted for client_contacts sync', () => {
  const clientId = '52e1a71a-1c93-4ec8-a566-e0eecaf06747'
  assertEquals(extractContactClientId({ client_id: clientId }), {
    provided: true,
    clientId,
  })
  assertEquals(extractContactClientId({ client_id: null }), {
    provided: true,
    clientId: null,
  })
  assertEquals(extractContactClientId({ display_name: 'Ada' }), {
    provided: false,
    clientId: null,
  })
  assertEquals(
    validateContactBody(
      { display_name: 'Ada', client_id: clientId },
      false,
    ).display_name,
    'Ada',
  )
  assertEquals(
    validateContactBody({ client_id: clientId }, true),
    {},
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

Deno.test('lead PATCH accepts atomic stage+position and optional client_id', () => {
  const clientId = '52e1a71a-1c93-4ec8-a566-e0eecaf06747'
  assertEquals(
    validateLeadBody({ stage: 'proposal', position: 10.5 }, true),
    { stage: 'proposal', position: 10.5 },
  )
  assertEquals(
    validateLeadBody({ client_id: clientId }, true),
    { client_id: clientId },
  )
  assertEquals(
    validateLeadBody({ client_id: null }, true),
    { client_id: null },
  )
})

Deno.test('lead currency resolves client default then organisation default', () => {
  assertEquals(
    resolveLeadCurrency({
      clientDefault: 'USD',
      orgDefault: 'GBP',
    }),
    'USD',
  )
  assertEquals(
    resolveLeadCurrency({
      clientDefault: null,
      orgDefault: 'GBP',
    }),
    'GBP',
  )
  assertEquals(
    resolveLeadCurrency({
      explicit: 'EUR',
      clientDefault: 'USD',
      orgDefault: 'GBP',
    }),
    'EUR',
  )
  assertEquals(
    resolveLeadCurrency({
      clientDefault: 'usd',
      orgDefault: 'GBP',
    }),
    'GBP',
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
  // V8 supportedValuesOf('timeZone') often omits literal "UTC".
  assertEquals(
    validateOrganisationCreateBody({
      name: 'UTC Org',
      slug: 'utc-org',
      country_code: 'GB',
      timezone: 'UTC',
    }).timezone,
    'UTC',
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

Deno.test('quote list status filter accepts the full quotes.status enum', () => {
  assertEquals(parseQuoteListStatus(null), null)
  assertEquals(parseQuoteListStatus('draft'), 'draft')
  assertEquals(parseQuoteListStatus('sent'), 'sent')
  assertEquals(parseQuoteListStatus('accepted'), 'accepted')
  assertEquals(parseQuoteListStatus('rejected'), 'rejected')
  assertEquals(parseQuoteListStatus('expired'), 'expired')
  assertEquals(parseQuoteListStatus('void'), 'void')
  assertThrows(() => parseQuoteListStatus('partial'), ApiError)
  assertThrows(() => parseQuoteListStatus('Draft'), ApiError)
  assertThrows(() => parseQuoteListStatus(''), ApiError)
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

Deno.test('invoice create validation defaults currency, requires client_id, and rejects calculated fields', () => {
  const productId = '11111111-1111-4111-8111-111111111111'
  const clientId = '22222222-2222-4222-8222-222222222222'
  assertEquals(
    validateInvoiceBody(
      {
        client_id: clientId,
        due_on: '2026-09-01',
        purchase_order_number: '  PO-42  ',
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
      client_id: clientId,
      currency: 'USD',
      due_on: '2026-09-01',
      purchase_order_number: 'PO-42',
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
      validateInvoiceBody(
        {
          lines: [],
        },
        false,
      ),
    ApiError,
  )
  assertThrows(
    () =>
      validateInvoiceBody(
        {
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
      validateInvoiceBody(
        {
          client_id: clientId,
          total_cents: 1,
          lines: [],
        },
        false,
      ),
    ApiError,
  )
  assertEquals(
    validateInvoiceBody(
      {
        purchase_order_number: 'PO-99',
        discount_cents: 100,
      },
      true,
    ),
    { purchase_order_number: 'PO-99', discount_cents: 100 },
  )
  assertThrows(() => validateInvoiceBody({}, true), ApiError)
  assertThrows(
    () => validateInvoiceBody({ client_id: null }, true),
    ApiError,
  )
  assertThrows(
    () =>
      decodeInvoiceCursor(
        btoa(JSON.stringify({ created_at: 'not-a-date', id: clientId }))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replace(/=+$/, ''),
      ),
    ApiError,
  )
})

Deno.test('invoice void_reason is required for the /void action body', () => {
  assertThrows(
    () =>
      validateInvoiceBody(
        {
          client_id: '22222222-2222-4222-8222-222222222222',
          void_reason: 'Duplicate invoice',
          lines: [],
        },
        false,
      ),
    ApiError,
  )
})

Deno.test('bill create validation requires vendor_id and number', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const body = validateBillBody(
    {
      vendor_id: id,
      number: 'V-1',
      currency: 'gbp',
      lines: [{ description: 'Paper', quantity: 1, unit_price_cents: 100, position: 0 }],
    },
    false,
  )
  assertEquals(body.currency, 'GBP')
  assertEquals(body.vendor_id, id)
  assertEquals(body.number, 'V-1')
  assertThrows(() => validateBillBody({ number: 'V-1' }, false), ApiError)
  assertThrows(
    () => validateBillBody({ vendor_id: id, total_cents: 1 }, false),
    ApiError,
  )
})

Deno.test('vendor create validation defaults status and rejects unknown fields', () => {
  const body = validateVendorBody(
    { name: 'Acme Vendor', primary_email: 'vendor@example.test' },
    false,
  )
  assertEquals(body.status, 'active')
  assertEquals(body.name, 'Acme Vendor')
  assertEquals(body.primary_email, 'vendor@example.test')
  assertThrows(
    () => validateVendorBody({ name: 'X', bank_details_encrypted: 'secret' }, false),
    ApiError,
  )
  assertThrows(
    () => validateVendorBody({ name: 'X', primary_email: 'not-an-email' }, false),
    ApiError,
  )
})

Deno.test('task create validation defaults priority/status/source and rejects reserved fields', () => {
  const body = validateTaskBody({ title: 'Ship Tasks BE' }, false)
  assertEquals(body.title, 'Ship Tasks BE')
  assertEquals(body.priority, 'p3')
  assertEquals(body.status, 'open')
  assertEquals(body.source, 'manual')
  assertEquals(body.position, 0)
  assertThrows(
    () => validateTaskBody({ title: 'X', assignee_agent_id: crypto.randomUUID() }, false),
    ApiError,
  )
  assertThrows(
    () => validateTaskBody({ title: 'X', entity_type: 'contact' }, false),
    ApiError,
  )
  assertThrows(
    () => validateTaskBody({ title: 'X', priority: 'urgent' }, false),
    ApiError,
  )
  const patched = validateTaskBody({ status: 'blocked', blocked_reason: 'Waiting' }, true)
  assertEquals(patched.status, 'blocked')
  assertEquals(patched.blocked_reason, 'Waiting')
})

Deno.test('task cursor round-trip shape', () => {
  const createdAt = '2026-08-02T18:00:00.000Z'
  const id = '11111111-1111-4111-8111-111111111111'
  const encoded = btoa(JSON.stringify({ created_at: createdAt, id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  const decoded = decodeTaskCursor(encoded)
  assertEquals(decoded.created_at, createdAt)
  assertEquals(decoded.id, id)
  assertThrows(() => decodeTaskCursor('not-a-cursor'), ApiError)
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

Deno.test('document upload intent validation defaults and rejects bad digests/sizes', () => {
  const ok = validateUploadIntentBody({
    name: ' contract.pdf ',
    category: 'contract',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    sha256: 'a'.repeat(64),
    folder_id: null,
  })
  assertEquals(ok.name, 'contract.pdf')
  assertEquals(ok.sha256, 'a'.repeat(64))

  assertThrows(
    () =>
      validateUploadIntentBody({
        name: 'x',
        category: 'contract',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        sha256: 'nope',
      }),
    ApiError,
  )
  assertThrows(
    () =>
      validateUploadIntentBody({
        name: 'x',
        category: 'contract',
        mime_type: 'application/pdf',
        size_bytes: 60_000_000,
        sha256: 'a'.repeat(64),
        storage_path: 'evil',
      }),
    ApiError,
  )
})

Deno.test('document folder create validation trims name and allows null parent', () => {
  const ok = validateFolderCreateBody({ name: ' Contracts ', parent_id: null })
  assertEquals(ok.name, 'Contracts')
  assertEquals(ok.parent_id, null)
  assertThrows(() => validateFolderCreateBody({ name: '' }), ApiError)
})

Deno.test('mailbox validation normalises email and rejects empty password rotate', () => {
  const ok = validateMailboxBody({
    email_address: '  Ada@Example.TEST ',
    from_name: ' Ada ',
    imap_host: 'imap.example.test',
    imap_port: 993,
    imap_security: 'tls',
    smtp_host: 'smtp.example.test',
    smtp_port: 587,
    smtp_security: 'starttls',
    username: 'ada@example.test',
    password: 'secret-pass',
  })
  assertEquals(ok.email_address, 'ada@example.test')
  assertEquals(ok.from_name, 'Ada')
  assertEquals(ok.password, 'secret-pass')

  assertThrows(
    () =>
      validateMailboxBody({
        email_address: 'ada@example.test',
        imap_host: 'imap.example.test',
        imap_port: 993,
        imap_security: 'tls',
        smtp_host: 'smtp.example.test',
        smtp_port: 587,
        smtp_security: 'tls',
        username: 'ada',
        password: '',
      }),
    ApiError,
  )
  assertThrows(
    () =>
      validateMailboxBody({
        email_address: 'not-an-email',
        imap_host: 'imap.example.test',
        imap_port: 993,
        imap_security: 'tls',
        smtp_host: 'smtp.example.test',
        smtp_port: 587,
        smtp_security: 'tls',
        username: 'ada',
      }),
    ApiError,
  )
})

Deno.test('mailbox test body accepts optional password only', () => {
  assertEquals(validateMailboxTestBody({}), { password: null })
  assertEquals(validateMailboxTestBody({ password: 'x' }), { password: 'x' })
  assertThrows(() => validateMailboxTestBody({ password: '' }), ApiError)
  assertThrows(() => validateMailboxTestBody({ host: 'nope' }), ApiError)
})

Deno.test('AI connect validation requires api_key and parses providers', () => {
  assertEquals(validateAiConnectBody({ api_key: 'sk-test-123456' }).api_key, 'sk-test-123456')
  assertThrows(() => validateAiConnectBody({ api_key: 'short' }), ApiError)
  assertThrows(() => validateAiConnectBody({ api_key: 'sk-test-123456', oauth: true }), ApiError)
  assertEquals(parseAiProvider('openai'), 'openai')
  assertEquals(parseAiProvider('openrouter'), 'openrouter')
  assertThrows(() => parseAiProvider('azure'), ApiError)
})

Deno.test('secret-echo guard treats auth_mode api_key value as safe, keys as forbidden', () => {
  assertEquals(
    payloadHasForbiddenSecretKey({
      provider: 'openai',
      config: { auth_mode: 'api_key' },
      credentials_configured: true,
    }),
    false,
  )
  assertEquals(payloadHasForbiddenSecretKey({ api_key: 'sk-leaked' }), true)
  assertEquals(payloadHasForbiddenSecretKey({ secret_ref: 'x' }), true)
  assertEquals(payloadHasForbiddenSecretKey({ password: 'x' }), true)
})

Deno.test('email share validation requires entity_type and entity_id UUID', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  assertEquals(validateShareBody({ entity_type: 'contact', entity_id: id }), {
    entity_type: 'contact',
    entity_id: id,
  })
  assertThrows(() => validateShareBody({ entity_type: 'invoice', entity_id: id }), ApiError)
  assertThrows(() => validateShareBody({ entity_type: 'contact', entity_id: 'nope' }), ApiError)
  assertThrows(
    () => validateShareBody({ entity_type: 'contact', entity_id: id, extra: true }),
    ApiError,
  )
})

Deno.test('AI email_reply generate/decide validation', () => {
  const id = '22222222-2222-4222-8222-222222222222'
  assertEquals(validateGenerateBody({ email_message_id: id }), {
    email_message_id: id,
    variant: 'neutral',
  })
  assertEquals(validateGenerateBody({ email_message_id: id, variant: 'warm' }).variant, 'warm')
  assertThrows(() => validateGenerateBody({ email_message_id: 'x' }), ApiError)
  assertEquals(validateDecideBody({}), { accepted_text: null })
  assertEquals(validateDecideBody({ accepted_text: 'Edited' }), { accepted_text: 'Edited' })
  assertThrows(() => validateDecideBody({ accepted_text: 1 }), ApiError)
  assertThrows(() => validateDecideBody({ send: true }), ApiError)
})

Deno.test('recurring schedule validation defaults and frequency fields', () => {
  const clientId = '11111111-1111-4111-8111-111111111111'
  const body = validateRecurringScheduleBody({
    name: 'Monthly retainer',
    client_id: clientId,
    frequency: 'monthly',
    day_of_month: 1,
    lines: [{
      description_template: 'Retainer {{period_start}}',
      quantity: 1,
      unit_price_cents: 1000,
    }],
  }, false)
  assertEquals(body.month_end_policy, 'clamp')
  assertEquals(body.catch_up_policy, 'latest')
  assertEquals(body.max_catch_up_runs, 1)
  assertEquals(body.pricing_mode, 'fixed')
  assertEquals(body.local_run_time, '09:00:00')
  assertEquals(body.delivery_mode, 'draft')
  assertEquals(body.lines.length, 1)

  assertThrows(
    () =>
      validateRecurringScheduleBody({
        name: 'Weekly',
        client_id: clientId,
        frequency: 'weekly',
        lines: [],
      }, false),
    ApiError,
  )

  const weekly = validateRecurringScheduleBody({
    name: 'Weekly',
    client_id: clientId,
    frequency: 'weekly',
    weekdays: [1, 3],
    lines: [{ description: 'Hours', quantity: 2, unit_price_cents: 5000 }],
  }, false)
  assertEquals(weekly.weekdays, [1, 3])
  assertEquals(weekly.lines[0].description_template, 'Hours')

  assertThrows(
    () =>
      validateRecurringScheduleBody({
        name: 'X',
        client_id: clientId,
        frequency: 'hourly',
        lines: [],
      }, false),
    ApiError,
  )
})

Deno.test('run-now idempotency payload omits expected_version', async () => {
  const scheduleId = '11111111-1111-4111-8111-111111111111'
  assertEquals(recurringLifecycleIdempotencyPayload('run-now', scheduleId, 1), {
    schedule_id: scheduleId,
  })
  assertEquals(recurringLifecycleIdempotencyPayload('run-now', scheduleId, 99), {
    schedule_id: scheduleId,
  })
  assertEquals(recurringLifecycleIdempotencyPayload('activate', scheduleId, 3), {
    schedule_id: scheduleId,
    expected_version: 3,
  })

  const route = `/api/v1/recurring-invoice-schedules/${scheduleId}/run-now`
  const hashV1 = await hashIdempotencyRequest(
    route,
    recurringLifecycleIdempotencyPayload('run-now', scheduleId, 1),
  )
  const hashV2 = await hashIdempotencyRequest(
    route,
    recurringLifecycleIdempotencyPayload('run-now', scheduleId, 2),
  )
  assertEquals(hashV1, hashV2)
})
