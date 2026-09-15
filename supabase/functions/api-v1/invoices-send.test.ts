import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { ApiError } from './http.ts'
import { handleInvoices } from './invoices.ts'

const ORG_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const INVOICE_ID = '33333333-3333-4444-8555-666666666666'
const CONTACT_ID = '44444444-4444-4555-8666-777777777777'

type Row = Record<string, unknown>

function invoiceDoc(overrides: Row = {}) {
  return {
    invoice: {
      id: INVOICE_ID,
      org_id: ORG_ID,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      created_by: null,
      updated_by: null,
      deleted_at: null,
      version: 1,
      number: 'INV-1',
      client_id: '55555555-5555-4666-8777-888888888888',
      contact_id: CONTACT_ID,
      quote_id: null,
      owner_membership_id: null,
      source: 'manual',
      recurring_run_id: null,
      billing_period_start: null,
      billing_period_end: null,
      status: 'draft',
      currency: 'GBP',
      issue_on: '2026-03-01',
      due_on: '2026-03-31',
      purchase_order_number: null,
      subtotal_cents: 10000,
      discount_cents: 0,
      tax_cents: 2000,
      total_cents: 12000,
      paid_cents: 0,
      balance_due_cents: 12000,
      party_snapshot: { client: { name: 'Acme' } },
      payment_terms: null,
      notes: null,
      internal_notes: null,
      sent_at: null,
      viewed_at: null,
      paid_at: null,
      voided_at: null,
      void_reason: null,
      ...overrides,
    },
    lines: [
      {
        id: '66666666-6666-4777-8888-999999999999',
        description: 'Retainer',
        quantity: 1,
        discount_percent: 0,
        total_cents: 10000,
        position: 0,
      },
    ],
    recipients: [{ contact_id: CONTACT_ID, position: 0 }],
  }
}

function sentEnvelope() {
  const doc = invoiceDoc({ status: 'sent', version: 2, sent_at: '2026-03-02T00:00:00Z' })
  return {
    replay: false,
    response_status: 200,
    response_body: { data: { ...doc.invoice, lines: doc.lines, recipients: doc.recipients } },
    response_headers: { etag: '"2"' },
  }
}

class QueryStub {
  constructor(
    private readonly result: { data: unknown; error: unknown },
  ) {}
  select() {
    return this
  }
  eq() {
    return this
  }
  in() {
    return this
  }
  is() {
    return this
  }
  order() {
    return this
  }
  maybeSingle() {
    return Promise.resolve(this.result)
  }
  then<T>(onFulfilled: (value: { data: unknown; error: unknown }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.result))
  }
}

function makeDb(opts: {
  document?: Row
  recipients?: Row[]
  contacts?: Row[]
  markSent?: () => { data: unknown; error: unknown }
}) {
  const rpcCalls: Array<{ name: string; args: Row }> = []
  const tables: string[] = []
  const db = {
    from(table: string) {
      tables.push(table)
      if (table === 'invoice_recipients') {
        return new QueryStub({ data: opts.recipients ?? [], error: null })
      }
      if (table === 'contacts') {
        return new QueryStub({ data: opts.contacts ?? [], error: null })
      }
      if (table === 'organisations') {
        return new QueryStub({ data: { name: 'HQ', legal_name: 'HQ Ltd' }, error: null })
      }
      if (table === 'clients') {
        return new QueryStub({ data: { name: 'Acme' }, error: null })
      }
      return new QueryStub({ data: null, error: null })
    },
    rpc(name: string, args: Row) {
      rpcCalls.push({ name, args })
      if (name === 'get_invoice_document') {
        return Promise.resolve({
          data: opts.document ?? invoiceDoc(),
          error: null,
        })
      }
      if (name === 'send_invoice_idempotent') {
        return Promise.resolve(
          opts.markSent?.() ?? { data: sentEnvelope(), error: null },
        )
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
  return {
    db: db as unknown as Parameters<typeof handleInvoices>[1],
    rpcCalls,
    tables,
  }
}

function call(
  db: Parameters<typeof handleInvoices>[1],
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({
    'if-match': '"1"',
    'idempotency-key': 'test-key-1',
    ...(init.headers ?? {}),
  })
  let body: string | undefined
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.body)
  }
  const req = new Request(`https://example.test${path}`, { method, headers, body })
  return handleInvoices(req, db, path, ORG_ID, 'req-inv', null)
}

Deno.test('mark-sent calls send_invoice_idempotent and does not query recipients', async () => {
  const { db, rpcCalls, tables } = makeDb({})
  const res = await call(db, 'POST', `/api/v1/invoices/${INVOICE_ID}/mark-sent`, {
    body: {},
  })
  assertEquals(res.status, 200)
  assertEquals(
    rpcCalls.some((c) => c.name === 'send_invoice_idempotent'),
    true,
  )
  assertEquals(
    rpcCalls.find((c) => c.name === 'send_invoice_idempotent')?.args.p_route,
    `/api/v1/invoices/${INVOICE_ID}/mark-sent`,
  )
  assertEquals(tables.includes('invoice_recipients'), false)
})

Deno.test('send without recipient emails fails with 422 and does not mark sent', async () => {
  const { db, rpcCalls } = makeDb({
    recipients: [{ contact_id: CONTACT_ID, position: 0 }],
    contacts: [{ id: CONTACT_ID, primary_email: null }],
  })
  const err = await assertRejects(
    () => call(db, 'POST', `/api/v1/invoices/${INVOICE_ID}/send`, { body: {} }),
    ApiError,
  )
  assertEquals(err.status, 422)
  assertEquals(
    rpcCalls.some((c) => c.name === 'send_invoice_idempotent'),
    false,
  )
})

Deno.test('send with no recipients fails before mark-sent', async () => {
  const { db, rpcCalls } = makeDb({ recipients: [] })
  const err = await assertRejects(
    () => call(db, 'POST', `/api/v1/invoices/${INVOICE_ID}/send`, { body: {} }),
    ApiError,
  )
  assertEquals(err.status, 422)
  assertEquals(err.message.includes('recipient'), true)
  assertEquals(
    rpcCalls.some((c) => c.name === 'send_invoice_idempotent'),
    false,
  )
})

Deno.test('unknown invoice action path 404s', () => {
  const { db } = makeDb({})
  const err = assertThrows(
    () => {
      void call(db, 'POST', `/api/v1/invoices/${INVOICE_ID}/activate`, { body: {} })
    },
    ApiError,
  )
  assertEquals(err.status, 404)
})
