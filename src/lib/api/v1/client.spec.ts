import { describe, expect, it, vi } from 'vitest';
import { createApiV1Client } from './client.js';
import { ApiClientError } from './errors.js';
import { apiError, createMockFetch } from './mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const QUOTE_ID = '11111111-2222-4333-8444-555555555555';

const sampleOrgMembership = {
	membership: {
		id: 'm1',
		role: 'owner' as const,
		status: 'active',
		joined_at: '2026-01-01T00:00:00Z'
	},
	organisation: {
		id: ORG_A,
		name: 'Corrin Data',
		slug: 'corrin-data',
		logo_path: null,
		default_currency: 'GBP',
		timezone: 'Europe/London',
		locale: 'en-GB',
		country_code: 'GB',
		theme_default: 'system' as const
	}
};

const sampleConfig = {
	id: ORG_A,
	name: 'Corrin Data',
	legal_name: null,
	slug: 'corrin-data',
	logo_path: null,
	billing_email: null,
	phone: null,
	website_url: null,
	tax_identifier: null,
	registration_number: null,
	default_currency: 'GBP',
	timezone: 'Europe/London',
	locale: 'en-GB',
	country_code: 'GB',
	theme_default: 'system' as const,
	settings: {},
	version: 3,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
	deleted_at: null
};

const sampleQuoteDocument = {
	id: QUOTE_ID,
	org_id: ORG_A,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
	created_by: null,
	updated_by: null,
	deleted_at: null,
	version: 1,
	number: 'Q-0001',
	title: 'Pilot quote',
	client_id: null,
	lead_id: null,
	contact_id: null,
	owner_membership_id: null,
	status: 'draft' as const,
	currency: 'GBP',
	issue_on: '2026-01-01',
	valid_until: null,
	subtotal_cents: 1000,
	discount_cents: 0,
	tax_cents: 200,
	total_cents: 1200,
	party_snapshot: {},
	terms: null,
	notes: null,
	internal_notes: null,
	sent_at: null,
	viewed_at: null,
	accepted_at: null,
	rejected_at: null,
	converted_invoice_id: null,
	lines: [
		{
			id: 'line-1',
			org_id: ORG_A,
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			version: 1,
			quote_id: QUOTE_ID,
			product_id: null,
			sku_snapshot: null,
			description: 'Consulting',
			quantity: 1,
			unit_price_cents: 1000,
			discount_percent: 0,
			tax_rate_percent: 20,
			subtotal_cents: 1000,
			tax_cents: 200,
			total_cents: 1200,
			position: 0
		}
	]
};

describe('createApiV1Client', () => {
	it('lists organisations without X-Org-Id', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async (request) => {
				expect(request.headers.get('x-org-id')).toBeNull();
				expect(request.headers.get('authorization')).toBe('Bearer tok');
				expect(request.headers.get('content-type')).toBeNull();
				return { body: { data: [sampleOrgMembership] } };
			}
		});

		const client = createApiV1Client({
			fetch: fetchMock,
			getAccessToken: () => 'tok',
			getOrgId: () => ORG_A
		});
		const rows = await client.organisations.list();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.organisation.id).toBe(ORG_A);
	});

	it('propagates X-Org-Id on org-scoped reads', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/organisation/configuration': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				return {
					headers: { etag: '"3"' },
					body: { data: sampleConfig }
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const config = await client.organisationConfig.get();
		expect(config.version).toBe(3);
	});

	it('throws ORG_CONTEXT_REQUIRED when org id is missing', async () => {
		const client = createApiV1Client({
			fetch: vi.fn(),
			getOrgId: () => null
		});
		await expect(client.taxRates.list()).rejects.toMatchObject({
			code: 'ORG_CONTEXT_REQUIRED',
			status: 400
		});
	});

	it('encodes list query params with URLSearchParams', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/tax-rates': async (request) => {
				const url = new URL(request.url);
				expect(url.searchParams.get('limit')).toBe('25');
				return { body: { data: [] } };
			},
			'GET /api/v1/quotes': async (request) => {
				const url = new URL(request.url);
				expect(url.searchParams.get('limit')).toBe('10');
				expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
				expect(url.searchParams.get('status')).toBe('draft');
				return {
					body: {
						data: [sampleQuoteDocument],
						meta: { next_cursor: 'next-opaque' }
					}
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await client.taxRates.list({ limit: 25 });
		const listed = await client.quotes.list({
			limit: 10,
			cursor: 'opaque-cursor',
			status: 'draft'
		});
		expect(listed.data).toHaveLength(1);
		expect(listed.meta?.next_cursor).toBe('next-opaque');
	});

	it('omits Content-Type when there is no body', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/profile/preferences': async (request) => {
				expect(request.headers.get('content-type')).toBeNull();
				return {
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				};
			},
			'DELETE /api/v1/tax-rates/tax-1': async (request) => {
				expect(request.headers.get('content-type')).toBeNull();
				expect(request.headers.get('if-match')).toBe('"2"');
				return { status: 204 };
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await client.profilePreferences.get();
		await client.taxRates.delete('tax-1', 2);
	});

	it('maps 403 / 412 / 422 responses with structured fields', async () => {
		const fetchMock = createMockFetch({
			'PATCH /api/v1/organisation/configuration': async () =>
				apiError(403, 'FORBIDDEN', 'Only owners and admins can update organisation configuration')
		});
		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await expect(
			client.organisationConfig.update({ timezone: 'UTC' }, 1)
		).rejects.toBeInstanceOf(ApiClientError);
		await expect(
			client.organisationConfig.update({ timezone: 'UTC' }, 1)
		).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'test-request-id' });

		const fetch412 = createMockFetch({
			'PATCH /api/v1/tax-rates/tax-1': async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				return apiError(412, 'PRECONDITION_FAILED', 'Tax rate version does not match If-Match');
			}
		});
		const client412 = createApiV1Client({ fetch: fetch412, getOrgId: () => ORG_A });
		await expect(
			client412.taxRates.update('tax-1', { name: 'VAT' }, 1)
		).rejects.toMatchObject({ status: 412, code: 'PRECONDITION_FAILED' });

		const fetch422 = createMockFetch({
			'POST /api/v1/tax-rates': async () =>
				apiError(422, 'VALIDATION_ERROR', 'Tax rate validation failed', {
					rate_percent: 'Must be a finite number from 0 to 100 with at most 4 decimals'
				})
		});
		const client422 = createApiV1Client({ fetch: fetch422, getOrgId: () => ORG_A });
		try {
			await client422.taxRates.create({ name: 'Bad', rate_percent: 200 });
			expect.unreachable('expected validation error');
		} catch (error) {
			expect(error).toBeInstanceOf(ApiClientError);
			expect((error as ApiClientError).isValidationError).toBe(true);
			expect((error as ApiClientError).fields?.rate_percent).toMatch(/finite number/i);
		}
	});

	it('maps network failures', async () => {
		const client = createApiV1Client({
			fetch: async () => {
				throw new TypeError('Failed to fetch');
			},
			getOrgId: () => null
		});
		await expect(client.organisations.list()).rejects.toMatchObject({
			code: 'NETWORK_ERROR',
			status: 0
		});
	});

	it('rejects malformed success envelopes', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: { meta: {} } })
		});
		const client = createApiV1Client({ fetch: fetchMock });
		await expect(client.organisations.list()).rejects.toMatchObject({
			code: 'INTERNAL_ERROR',
			message: 'Response envelope was missing data'
		});
	});

	it('sends If-Match on configuration patch', async () => {
		const fetchMock = createMockFetch({
			'PATCH /api/v1/organisation/configuration': async (request) => {
				expect(request.headers.get('if-match')).toBe('"7"');
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				expect(request.headers.get('content-type')).toMatch(/application\/json/);
				const body = await request.json();
				expect(body).toEqual({ default_currency: 'USD' });
				return {
					headers: { etag: '"8"' },
					body: {
						data: {
							...sampleConfig,
							default_currency: 'USD',
							timezone: 'UTC',
							theme_default: 'dark',
							version: 8,
							updated_at: '2026-01-02T00:00:00Z'
						}
					}
				};
			}
		});
		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const updated = await client.organisationConfig.update({ default_currency: 'USD' }, 7);
		expect(updated.version).toBe(8);
		expect(updated.default_currency).toBe('USD');
	});

	it('supports quote draft CRUD with ETag / If-Match / 204', async () => {
		const fetchMock = createMockFetch({
			'POST /api/v1/quotes': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const body = await request.json();
				expect(body.title).toBe('Pilot quote');
				expect(body.lines).toHaveLength(1);
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: { data: sampleQuoteDocument }
				};
			},
			[`GET /api/v1/quotes/${QUOTE_ID}`]: async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				return {
					headers: { etag: '"1"' },
					body: { data: sampleQuoteDocument }
				};
			},
			[`PATCH /api/v1/quotes/${QUOTE_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				const body = await request.json();
				expect(body.title).toBe('Revised');
				return {
					headers: { etag: '"2"' },
					body: {
						data: { ...sampleQuoteDocument, title: 'Revised', version: 2 }
					}
				};
			},
			[`DELETE /api/v1/quotes/${QUOTE_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				expect(request.headers.get('content-type')).toBeNull();
				return { status: 204 };
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const created = await client.quotes.create({
			title: 'Pilot quote',
			lines: [{ quantity: 1, unit_price_cents: 1000, description: 'Consulting' }]
		});
		expect(created.id).toBe(QUOTE_ID);

		const got = await client.quotes.get(QUOTE_ID);
		expect(got.etag).toBe('"1"');
		expect(got.data.number).toBe('Q-0001');

		const updated = await client.quotes.update(QUOTE_ID, { title: 'Revised' }, 1);
		expect(updated.version).toBe(2);

		await client.quotes.delete(QUOTE_ID, 2);
	});

	it('uses an explicit baseUrl override when provided', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async (request) => {
				expect(new URL(request.url).origin).toBe('https://api.example.test');
				return { body: { data: [] } };
			}
		});
		const client = createApiV1Client({
			baseUrl: 'https://api.example.test',
			fetch: fetchMock
		});
		await client.organisations.list();
	});
});
