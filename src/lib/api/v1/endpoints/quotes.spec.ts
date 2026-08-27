import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const QUOTE_ID = '44444444-3333-4444-8555-666666666666';

function quoteFixture() {
	return {
		id: QUOTE_ID,
		version: 1,
		status: 'draft',
		total_amount: 900,
		currency: 'GBP'
	};
}

describe('quotes endpoints', () => {
	it('create POSTs the quote body', async () => {
		let capturedBody: unknown;
		const fetchMock = createMockFetch({
			'POST /api/v1/quotes': async (request) => {
				capturedBody = await request.json();
				return { body: { data: quoteFixture() }, status: 201 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.quotes.create({ client_id: 'c1', lines: [] } as never);
		expect(capturedBody).toMatchObject({ client_id: 'c1' });
	});

	it('update sends If-Match from version', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/quotes/${QUOTE_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { body: { data: quoteFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.quotes.update(QUOTE_ID, { notes: 'ok' } as never, 1);
		expect(capturedIfMatch).toBe('"1"');
	});

	it('accept adds an Idempotency-Key header and transitions status', async () => {
		let capturedIdempotencyKey: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/quotes/${QUOTE_ID}/accept`]: async (request) => {
				capturedIdempotencyKey = request.headers.get('Idempotency-Key');
				return {
					body: { data: { ...quoteFixture(), status: 'accepted' } }
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const accepted = await api.quotes.accept(QUOTE_ID, 1);
		expect(capturedIdempotencyKey).toBeTruthy();
		expect(accepted.status).toBe('accepted');
	});

	it('send posts empty body with If-Match', async () => {
		let capturedBody: unknown;
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/quotes/${QUOTE_ID}/send`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				capturedBody = await request.json();
				return {
					body: { data: { ...quoteFixture(), status: 'sent' } }
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const sent = await api.quotes.send(QUOTE_ID, 1);
		expect(capturedIfMatch).toBe('"1"');
		expect(capturedBody).toEqual({});
		expect(sent.status).toBe('sent');
	});

	it('reject transitions to rejected', async () => {
		const fetchMock = createMockFetch({
			[`POST /api/v1/quotes/${QUOTE_ID}/reject`]: async () => ({
				body: { data: { ...quoteFixture(), status: 'rejected' } }
			})
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const rejected = await api.quotes.reject(QUOTE_ID, 1);
		expect(rejected.status).toBe('rejected');
	});

	it('delete sends If-Match and expects no content', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`DELETE /api/v1/quotes/${QUOTE_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { status: 204 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.quotes.delete(QUOTE_ID, 1);
		expect(capturedIfMatch).toBe('"1"');
	});
});
