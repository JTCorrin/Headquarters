import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const INVOICE_ID = '33333333-3333-4444-8555-666666666666';

function invoiceFixture() {
	return {
		id: INVOICE_ID,
		version: 2,
		status: 'draft',
		total_amount: 500,
		currency: 'GBP'
	};
}

describe('invoices endpoints', () => {
	it('list passes filters and returns data', async () => {
		let seenQuery = '';
		const fetchMock = createMockFetch({
			'GET /api/v1/invoices': async (request) => {
				seenQuery = new URL(request.url).search;
				return {
					body: {
						data: [invoiceFixture()],
						meta: { next_cursor: null }
					}
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.invoices.list({ status: 'draft', client_id: 'c1' });
		expect(seenQuery).toContain('status=draft');
		expect(seenQuery).toContain('client_id=c1');
		expect(listed.data[0]?.id).toBe(INVOICE_ID);
	});

	it('createFromQuote posts to /from-quote', async () => {
		let capturedBody: unknown;
		let capturedPath = '';
		const fetchMock = createMockFetch({
			'POST /api/v1/invoices/from-quote': async (request) => {
				capturedPath = new URL(request.url).pathname;
				capturedBody = await request.json();
				return { body: { data: invoiceFixture() }, status: 201 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.invoices.createFromQuote({ quote_id: 'q1' } as never);
		expect(capturedPath).toBe('/api/v1/invoices/from-quote');
		expect(capturedBody).toEqual({ quote_id: 'q1' });
	});

	it('update sends If-Match from version', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/invoices/${INVOICE_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { body: { data: invoiceFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.invoices.update(INVOICE_ID, { notes: 'ok' } as never, 2);
		expect(capturedIfMatch).toBe('"2"');
	});

	it('send adds an Idempotency-Key header', async () => {
		let capturedIdempotencyKey: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/invoices/${INVOICE_ID}/send`]: async (request) => {
				capturedIdempotencyKey = request.headers.get('Idempotency-Key');
				return {
					body: { data: { ...invoiceFixture(), status: 'sent' } }
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const sent = await api.invoices.send(INVOICE_ID, 2, { to_email: 'a@b.com' } as never);
		expect(capturedIdempotencyKey).toBeTruthy();
		expect(sent.status).toBe('sent');
	});

	it('void adds an Idempotency-Key header and reason body', async () => {
		let capturedBody: unknown;
		let capturedIdempotencyKey: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/invoices/${INVOICE_ID}/void`]: async (request) => {
				capturedIdempotencyKey = request.headers.get('Idempotency-Key');
				capturedBody = await request.json();
				return {
					body: { data: { ...invoiceFixture(), status: 'void' } }
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const voided = await api.invoices.void(INVOICE_ID, { reason: 'mistake' } as never, 2);
		expect(capturedIdempotencyKey).toBeTruthy();
		expect(capturedBody).toEqual({ reason: 'mistake' });
		expect(voided.status).toBe('void');
	});
});
