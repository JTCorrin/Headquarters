import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VENDOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-cccccccccccc';
const BILL_ID = '22222222-3333-4444-8555-666666666666';

function billFixture() {
	return {
		id: BILL_ID,
		version: 3,
		status: 'draft',
		vendor_id: VENDOR_ID,
		total_amount: 120,
		currency: 'GBP'
	};
}

describe('bills endpoints', () => {
	it('list passes status filter and returns data', async () => {
		let seenStatus: string | null = null;
		const fetchMock = createMockFetch({
			'GET /api/v1/bills': async (request) => {
				seenStatus = new URL(request.url).searchParams.get('status');
				return {
					body: {
						data: [billFixture()],
						meta: { next_cursor: null }
					}
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.bills.list({ status: 'draft' });
		expect(seenStatus).toBe('draft');
		expect(listed.data[0]?.id).toBe(BILL_ID);
	});

	it('create POSTs the vendor and amounts', async () => {
		let capturedBody: unknown;
		const fetchMock = createMockFetch({
			'POST /api/v1/bills': async (request) => {
				capturedBody = await request.json();
				return { body: { data: billFixture() }, status: 201 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.bills.create({ vendor_id: VENDOR_ID, lines: [] } as never);
		expect(capturedBody).toMatchObject({ vendor_id: VENDOR_ID });
	});

	it('update sends If-Match from version', async () => {
		let capturedIfMatch: string | null = null;
		let capturedMethod = '';
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/bills/${BILL_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				capturedMethod = request.method;
				return { body: { data: billFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.bills.update(BILL_ID, { notes: 'ok' } as never, 3);
		expect(capturedMethod).toBe('PATCH');
		expect(capturedIfMatch).toBe('"3"');
	});

	it('receive transitions draft → received with If-Match', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/bills/${BILL_ID}/receive`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return {
					body: { data: { ...billFixture(), status: 'received' } }
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const received = await api.bills.receive(BILL_ID, 3);
		expect(capturedIfMatch).toBe('"3"');
		expect(received.status).toBe('received');
	});

	it('delete sends If-Match and expects no content', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`DELETE /api/v1/bills/${BILL_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { status: 204 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.bills.delete(BILL_ID, 3);
		expect(capturedIfMatch).toBe('"3"');
	});

	it('void posts a reason with If-Match', async () => {
		let capturedBody: unknown;
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/bills/${BILL_ID}/void`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				capturedBody = await request.json();
				return {
					body: { data: { ...billFixture(), status: 'void' } }
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const voided = await api.bills.void(BILL_ID, { reason: 'duplicate' } as never, 3);
		expect(capturedIfMatch).toBe('"3"');
		expect(capturedBody).toEqual({ reason: 'duplicate' });
		expect(voided.status).toBe('void');
	});
});
