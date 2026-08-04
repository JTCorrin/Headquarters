import { describe, expect, it, vi } from 'vitest';
import { resolveApiV1BaseUrl } from './base-url.js';
import { createApiV1Client } from './client.js';
import { ApiClientError } from './errors.js';
import { apiError, createMockFetch } from './mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORG_B = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const QUOTE_ID = '11111111-2222-4333-8444-555555555555';
const CONTACT_ID = '22222222-3333-4444-8555-666666666666';

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
	client_id: CLIENT_ID,
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
				expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
				return {
					body: {
						data: [sampleQuoteDocument],
						meta: { next_cursor: 'next-opaque' }
					}
				};
			},
			'GET /api/v1/invoices': async (request) => {
				const url = new URL(request.url);
				expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
				expect(url.searchParams.get('limit')).toBe('20');
				return { body: { data: [] } };
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await client.taxRates.list({ limit: 25 });
		const listed = await client.quotes.list({
			limit: 10,
			cursor: 'opaque-cursor',
			status: 'draft',
			client_id: CLIENT_ID
		});
		expect(listed.data).toHaveLength(1);
		expect(listed.meta?.next_cursor).toBe('next-opaque');
		await client.invoices.list({ client_id: CLIENT_ID, limit: 20 });
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

	it('supports contact CRUD with ETag / If-Match / 204', async () => {
		const sampleContact = {
			id: CONTACT_ID,
			org_id: ORG_A,
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			deleted_at: null,
			version: 1,
			first_name: null,
			last_name: null,
			display_name: 'Ava Chen',
			primary_email: 'ava@northwind.com',
			primary_phone: null,
			job_title: null,
			company_name: 'Northwind',
			client_id: CLIENT_ID,
			owner_membership_id: null,
			lifecycle_status: 'active' as const,
			source: null,
			notes: null,
			last_contacted_at: null,
			metadata: {}
		};

		const fetchMock = createMockFetch({
			'GET /api/v1/contacts': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const url = new URL(request.url);
				expect(url.searchParams.get('limit')).toBe('25');
				expect(url.searchParams.get('lifecycle_status')).toBe('active');
				return { body: { data: [sampleContact], meta: { next_cursor: null } } };
			},
			'POST /api/v1/contacts': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const body = await request.json();
				expect(body.display_name).toBe('Ava Chen');
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: { data: sampleContact }
				};
			},
			[`GET /api/v1/contacts/${CONTACT_ID}`]: async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				return {
					headers: { etag: '"1"' },
					body: { data: sampleContact }
				};
			},
			[`PATCH /api/v1/contacts/${CONTACT_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				const body = await request.json();
				expect(body.lifecycle_status).toBe('inactive');
				return {
					body: {
						data: { ...sampleContact, version: 2, lifecycle_status: 'inactive' }
					}
				};
			},
			[`DELETE /api/v1/contacts/${CONTACT_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				expect(request.headers.get('content-type')).toBeNull();
				return { status: 204 };
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await client.contacts.list({ limit: 25, lifecycle_status: 'active' });
		expect(listed.data).toHaveLength(1);
		expect(listed.data[0]?.display_name).toBe('Ava Chen');

		const created = await client.contacts.create({
			display_name: 'Ava Chen',
			primary_email: 'ava@northwind.com',
			company_name: 'Northwind'
		});
		expect(created.id).toBe(CONTACT_ID);

		const got = await client.contacts.get(CONTACT_ID);
		expect(got.etag).toBe('"1"');
		expect(got.data.company_name).toBe('Northwind');

		const updated = await client.contacts.update(
			CONTACT_ID,
			{ lifecycle_status: 'inactive' },
			1
		);
		expect(updated.version).toBe(2);

		await client.contacts.delete(CONTACT_ID, 2);
	});

	it('supports quote draft CRUD with ETag / If-Match / 204', async () => {
		const fetchMock = createMockFetch({
			'POST /api/v1/quotes': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const body = await request.json();
				expect(body.title).toBe('Pilot quote');
				expect(body.client_id).toBe(CLIENT_ID);
				expect(body.lines).toEqual([
					{
						description: 'Consulting',
						quantity: 1,
						unit_price_cents: 1000
					}
				]);
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
			client_id: CLIENT_ID,
			lines: [{ description: 'Consulting', quantity: 1, unit_price_cents: 1000 }]
		});
		expect(created.id).toBe(QUOTE_ID);
		expect(created.client_id).toBe(CLIENT_ID);

		const got = await client.quotes.get(QUOTE_ID);
		expect(got.etag).toBe('"1"');
		expect(got.data.number).toBe('Q-0001');

		const updated = await client.quotes.update(QUOTE_ID, { title: 'Revised' }, 1);
		expect(updated.version).toBe(2);

		await client.quotes.delete(QUOTE_ID, 2);
	});

	it('covers products CRUD plus quote accept', async () => {
		const PRODUCT_ID = 'dddddddd-dddd-4eee-8fff-000000000099';
		const fetchMock = createMockFetch({
			'GET /api/v1/products': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				expect(new URL(request.url).searchParams.get('status')).toBe('active');
				return {
					body: {
						data: [
							{
								id: PRODUCT_ID,
								org_id: ORG_A,
								created_at: '2026-03-01T00:00:00Z',
								updated_at: '2026-03-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								sku: 'WID-1',
								name: 'Widget',
								description: null,
								category_id: null,
								product_type: 'product',
								unit_name: null,
								unit_price_cents: 2500,
								cost_price_cents: null,
								currency: 'GBP',
								tax_rate_id: null,
								track_stock: true,
								stock_qty: 0,
								low_stock_at: null,
								status: 'active',
								metadata: {}
							}
						]
					}
				};
			},
			'POST /api/v1/products': async (request) => {
				const body = await request.json();
				expect(body.sku).toBe('WID-2');
				return {
					headers: { etag: '"1"' },
					body: {
						data: {
							id: PRODUCT_ID,
							org_id: ORG_A,
							created_at: '2026-03-01T00:00:00Z',
							updated_at: '2026-03-01T00:00:00Z',
							created_by: null,
							updated_by: null,
							deleted_at: null,
							version: 1,
							sku: 'WID-2',
							name: 'Widget Two',
							description: null,
							category_id: null,
							product_type: 'product',
							unit_name: null,
							unit_price_cents: 3000,
							cost_price_cents: null,
							currency: 'GBP',
							tax_rate_id: null,
							track_stock: false,
							stock_qty: 0,
							low_stock_at: null,
							status: 'active',
							metadata: {}
						}
					}
				};
			},
			[`POST /api/v1/products/${PRODUCT_ID}/adjust-stock`]: async (request) => {
				expect(request.headers.get('idempotency-key')).toBeTruthy();
				const body = await request.json();
				expect(body.quantity_delta).toBe(5);
				return {
					body: {
						data: {
							id: PRODUCT_ID,
							org_id: ORG_A,
							created_at: '2026-03-01T00:00:00Z',
							updated_at: '2026-03-01T00:00:00Z',
							created_by: null,
							updated_by: null,
							deleted_at: null,
							version: 2,
							sku: 'WID-2',
							name: 'Widget Two',
							description: null,
							category_id: null,
							product_type: 'product',
							unit_name: null,
							unit_price_cents: 3000,
							cost_price_cents: null,
							currency: 'GBP',
							tax_rate_id: null,
							track_stock: true,
							stock_qty: 5,
							low_stock_at: null,
							status: 'active',
							metadata: {}
						}
					}
				};
			},
			[`POST /api/v1/quotes/${QUOTE_ID}/accept`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				return {
					headers: { etag: '"3"' },
					body: {
						data: {
							...sampleQuoteDocument,
							version: 3,
							status: 'accepted',
							accepted_at: '2026-03-02T00:00:00Z'
						}
					}
				};
			},
			[`POST /api/v1/quotes/${QUOTE_ID}/send`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				return {
					headers: { etag: '"2"' },
					body: {
						data: {
							...sampleQuoteDocument,
							version: 2,
							status: 'sent',
							sent_at: '2026-03-02T00:00:00Z'
						}
					}
				};
			},
			[`POST /api/v1/quotes/${QUOTE_ID}/reject`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				return {
					headers: { etag: '"3"' },
					body: {
						data: {
							...sampleQuoteDocument,
							version: 3,
							status: 'rejected',
							rejected_at: '2026-03-02T00:00:00Z'
						}
					}
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await client.products.list({ status: 'active' });
		expect(listed.data[0]?.sku).toBe('WID-1');

		const created = await client.products.create({
			sku: 'WID-2',
			name: 'Widget Two',
			unit_price_cents: 3000
		});
		expect(created.id).toBe(PRODUCT_ID);

		const adjusted = await client.products.adjustStock(PRODUCT_ID, {
			quantity_delta: 5,
			reason: 'opening'
		});
		expect(adjusted.stock_qty).toBe(5);

		const sent = await client.quotes.send(QUOTE_ID, 1);
		expect(sent.status).toBe('sent');

		const rejected = await client.quotes.reject(QUOTE_ID, 2);
		expect(rejected.status).toBe('rejected');

		const accepted = await client.quotes.accept(QUOTE_ID, 2);
		expect(accepted.status).toBe('accepted');
	});

	it('supports invoice draft CRUD, send/void, and from-quote with ETag / If-Match', async () => {
		const INVOICE_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
		const sampleInvoiceDocument = {
			id: INVOICE_ID,
			org_id: ORG_A,
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			deleted_at: null,
			version: 1,
			number: 'INV-0001',
			client_id: CLIENT_ID,
			contact_id: null,
			quote_id: null,
			owner_membership_id: null,
			source: 'manual' as const,
			recurring_run_id: null,
			billing_period_start: null,
			billing_period_end: null,
			status: 'draft' as const,
			currency: 'GBP',
			issue_on: '2026-03-01',
			due_on: '2026-04-01',
			purchase_order_number: null,
			subtotal_cents: 1000,
			discount_cents: 0,
			tax_cents: 200,
			total_cents: 1200,
			paid_cents: 0,
			balance_due_cents: 1200,
			party_snapshot: { name: 'Northwind' },
			payment_terms: null,
			notes: null,
			internal_notes: null,
			sent_at: null,
			viewed_at: null,
			paid_at: null,
			voided_at: null,
			void_reason: null,
			lines: []
		};

		const fetchMock = createMockFetch({
			'POST /api/v1/invoices': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const body = await request.json();
				expect(body.client_id).toBe(CLIENT_ID);
				expect(body.lines).toEqual([]);
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: { data: sampleInvoiceDocument }
				};
			},
			'POST /api/v1/invoices/from-quote': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const body = await request.json();
				expect(body.quote_id).toBe(QUOTE_ID);
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: {
						data: {
							...sampleInvoiceDocument,
							source: 'quote',
							quote_id: QUOTE_ID
						}
					}
				};
			},
			[`GET /api/v1/invoices/${INVOICE_ID}`]: async () => ({
				headers: { etag: '"1"' },
				body: { data: sampleInvoiceDocument }
			}),
			[`PATCH /api/v1/invoices/${INVOICE_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				return {
					headers: { etag: '"2"' },
					body: { data: { ...sampleInvoiceDocument, version: 2, due_on: '2026-05-01' } }
				};
			},
			[`POST /api/v1/invoices/${INVOICE_ID}/send`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				return {
					headers: { etag: '"3"' },
					body: {
						data: {
							...sampleInvoiceDocument,
							version: 3,
							status: 'sent',
							sent_at: '2026-03-02T00:00:00Z'
						}
					}
				};
			},
			[`POST /api/v1/invoices/${INVOICE_ID}/void`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"3"');
				const body = await request.json();
				expect(body.void_reason).toBe('Duplicate');
				return {
					headers: { etag: '"4"' },
					body: {
						data: {
							...sampleInvoiceDocument,
							version: 4,
							status: 'void',
							void_reason: 'Duplicate'
						}
					}
				};
			},
			[`DELETE /api/v1/invoices/${INVOICE_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				return { status: 204 };
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const created = await client.invoices.create({
			client_id: CLIENT_ID,
			currency: 'GBP',
			issue_on: '2026-03-01',
			due_on: '2026-04-01',
			lines: []
		});
		expect(created.number).toBe('INV-0001');

		const fromQuote = await client.invoices.createFromQuote({ quote_id: QUOTE_ID });
		expect(fromQuote.quote_id).toBe(QUOTE_ID);

		const got = await client.invoices.get(INVOICE_ID);
		expect(got.etag).toBe('"1"');

		const updated = await client.invoices.update(INVOICE_ID, { due_on: '2026-05-01' }, 1);
		expect(updated.version).toBe(2);

		const sent = await client.invoices.send(INVOICE_ID, 2);
		expect(sent.status).toBe('sent');

		const voided = await client.invoices.void(INVOICE_ID, { void_reason: 'Duplicate' }, 3);
		expect(voided.status).toBe('void');

		await client.invoices.delete(INVOICE_ID, 1);
	});

	it('retains initiating org when token resolve races with an org switch', async () => {
		let selectedOrg = ORG_A;
		let releaseToken!: (token: string) => void;
		const deferredToken = new Promise<string>((resolve) => {
			releaseToken = resolve;
		});

		const fetchMock = createMockFetch({
			'PATCH /api/v1/organisation/configuration': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				expect(request.headers.get('authorization')).toBe('Bearer late-token');
				return {
					headers: { etag: '"4"' },
					body: { data: { ...sampleConfig, version: 4 } }
				};
			}
		});

		const client = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => selectedOrg,
			getAccessToken: () => deferredToken
		});

		const pending = client.organisationConfig.update({ timezone: 'UTC' }, 3);
		selectedOrg = ORG_B;
		releaseToken('late-token');
		const updated = await pending;
		expect(updated.version).toBe(4);
	});

	it('uses composition-root resolveApiV1BaseUrl + baseUrl so configured origin reaches requests', async () => {
		const configured = resolveApiV1BaseUrl('https://api.example.test/');
		expect(configured).toBe('https://api.example.test');

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async (request) => {
				expect(request.url).toBe('https://api.example.test/api/v1/organisations');
				return { body: { data: [] } };
			}
		});
		const client = createApiV1Client({
			baseUrl: configured,
			fetch: fetchMock
		});
		await client.organisations.list();
	});

	it('covers document browse, folder CRUD, upload-intent, finalize, download, rename/move/delete/restore', async () => {
		const folderId = '11111111-2222-4333-8444-555555555555';
		const documentId = '22222222-3333-4444-8555-666666666666';
		const sha = 'a'.repeat(64);

		const fetchMock = createMockFetch({
			[`GET /api/v1/entities/client/${CLIENT_ID}/documents`]: async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const url = new URL(request.url);
				expect(url.searchParams.get('folder_id')).toBe(folderId);
				return {
					body: {
						data: {
							folders: [],
							documents: []
						}
					}
				};
			},
			[`POST /api/v1/entities/client/${CLIENT_ID}/folders`]: async (request) => {
				expect(await request.json()).toEqual({ name: 'Contracts', parent_id: null });
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: {
						data: {
							folder: {
								id: folderId,
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								entity_type: 'client',
								entity_id: CLIENT_ID,
								parent_id: null,
								name: 'Contracts'
							}
						}
					}
				};
			},
			[`PATCH /api/v1/document-folders/${folderId}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				expect(await request.json()).toEqual({ name: 'Legal' });
				return {
					headers: { etag: '"2"' },
					body: {
						data: {
							folder: {
								id: folderId,
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 2,
								entity_type: 'client',
								entity_id: CLIENT_ID,
								parent_id: null,
								name: 'Legal'
							}
						}
					}
				};
			},
			[`DELETE /api/v1/document-folders/${folderId}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				return { status: 204 };
			},
			[`POST /api/v1/document-folders/${folderId}/restore`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				return {
					body: {
						data: {
							folder: {
								id: folderId,
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 3,
								entity_type: 'client',
								entity_id: CLIENT_ID,
								parent_id: null,
								name: 'Legal'
							}
						}
					}
				};
			},
			[`POST /api/v1/entities/client/${CLIENT_ID}/documents/upload-intent`]: async (
				request
			) => {
				expect(await request.json()).toEqual({
					name: 'msa.pdf',
					category: 'contract',
					mime_type: 'application/pdf',
					size_bytes: 10,
					sha256: sha,
					folder_id: folderId
				});
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: {
						data: {
							document: {
								id: documentId,
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								name: 'msa.pdf',
								category: 'contract',
								notes: null,
								bucket: 'org-documents',
								storage_path: `${ORG_A}/msa.pdf`,
								storage_version: null,
								mime_type: 'application/pdf',
								size_bytes: 10,
								sha256: sha,
								uploaded_by: null,
								uploaded_at: null,
								scan_status: 'pending',
								metadata: {},
								status: 'pending_upload',
								upload_expires_at: '2026-08-01T02:00:00Z'
							},
							link: {
								id: '33333333-4444-4555-8666-777777777777',
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								document_id: documentId,
								entity_type: 'client',
								entity_id: CLIENT_ID,
								folder_id: folderId
							},
							upload: {
								signed_url: 'https://storage.example.test/put',
								token: 'upload-token',
								path: `${ORG_A}/msa.pdf`,
								expires_in: 3600
							}
						}
					}
				};
			},
			[`POST /api/v1/documents/${documentId}/finalize`]: async (request) => {
				expect(await request.json()).toEqual({
					expected_size_bytes: 10,
					expected_sha256: sha
				});
				return {
					headers: { etag: '"2"' },
					body: {
						data: {
							document: {
								id: documentId,
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 2,
								name: 'msa.pdf',
								category: 'contract',
								notes: null,
								bucket: 'org-documents',
								storage_path: `${ORG_A}/msa.pdf`,
								storage_version: null,
								mime_type: 'application/pdf',
								size_bytes: 10,
								sha256: sha,
								uploaded_by: null,
								uploaded_at: '2026-08-01T01:00:00Z',
								scan_status: 'pending',
								metadata: {},
								status: 'ready',
								upload_expires_at: null
							}
						}
					}
				};
			},
			[`GET /api/v1/documents/${documentId}/download`]: async () => ({
				body: {
					data: {
						document_id: documentId,
						signed_url: 'https://storage.example.test/get',
						expires_in: 300,
						mime_type: 'application/pdf',
						name: 'msa.pdf'
					}
				}
			}),
			[`PATCH /api/v1/documents/${documentId}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				expect(await request.json()).toEqual({ name: 'msa-v2.pdf' });
				return {
					headers: { etag: '"3"' },
					body: {
						data: {
							document: {
								id: documentId,
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 3,
								name: 'msa-v2.pdf',
								category: 'contract',
								notes: null,
								bucket: 'org-documents',
								storage_path: `${ORG_A}/msa.pdf`,
								storage_version: null,
								mime_type: 'application/pdf',
								size_bytes: 10,
								sha256: sha,
								uploaded_by: null,
								uploaded_at: '2026-08-01T01:00:00Z',
								scan_status: 'pending',
								metadata: {},
								status: 'ready',
								upload_expires_at: null
							}
						}
					}
				};
			},
			[`POST /api/v1/documents/${documentId}/move`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				expect(await request.json()).toEqual({
					entity_type: 'client',
					entity_id: CLIENT_ID,
					folder_id: null
				});
				return {
					headers: { etag: '"2"' },
					body: {
						data: {
							link: {
								id: '33333333-4444-4555-8666-777777777777',
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 2,
								document_id: documentId,
								entity_type: 'client',
								entity_id: CLIENT_ID,
								folder_id: null
							}
						}
					}
				};
			},
			[`DELETE /api/v1/documents/${documentId}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"3"');
				return { status: 204 };
			},
			[`POST /api/v1/documents/${documentId}/restore`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"3"');
				return {
					headers: { etag: '"4"' },
					body: {
						data: {
							document: {
								id: documentId,
								org_id: ORG_A,
								created_at: '2026-08-01T00:00:00Z',
								updated_at: '2026-08-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 4,
								name: 'msa-v2.pdf',
								category: 'contract',
								notes: null,
								bucket: 'org-documents',
								storage_path: `${ORG_A}/msa.pdf`,
								storage_version: null,
								mime_type: 'application/pdf',
								size_bytes: 10,
								sha256: sha,
								uploaded_by: null,
								uploaded_at: '2026-08-01T01:00:00Z',
								scan_status: 'pending',
								metadata: {},
								status: 'ready',
								upload_expires_at: null
							}
						}
					}
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });

		const browse = await client.documents.browse('client', CLIENT_ID, {
			folder_id: folderId
		});
		expect(browse.folders).toEqual([]);

		const createdFolder = await client.documents.createFolder('client', CLIENT_ID, {
			name: 'Contracts',
			parent_id: null
		});
		expect(createdFolder.folder.id).toBe(folderId);

		const renamedFolder = await client.documents.updateFolder(
			folderId,
			{ name: 'Legal' },
			1
		);
		expect(renamedFolder.folder.version).toBe(2);

		await client.documents.deleteFolder(folderId, 2);
		const restoredFolder = await client.documents.restoreFolder(folderId, 2);
		expect(restoredFolder.folder.version).toBe(3);

		const intent = await client.documents.createUploadIntent('client', CLIENT_ID, {
			name: 'msa.pdf',
			category: 'contract',
			mime_type: 'application/pdf',
			size_bytes: 10,
			sha256: sha,
			folder_id: folderId
		});
		expect(intent.upload.signed_url).toContain('storage.example.test');

		const finalized = await client.documents.finalize(documentId, {
			expected_size_bytes: 10,
			expected_sha256: sha
		});
		expect(finalized.document.status).toBe('ready');

		const download = await client.documents.download(documentId);
		expect(download.signed_url).toContain('/get');

		const renamed = await client.documents.rename(documentId, { name: 'msa-v2.pdf' }, 2);
		expect(renamed.document.name).toBe('msa-v2.pdf');

		const moved = await client.documents.move(
			documentId,
			{ entity_type: 'client', entity_id: CLIENT_ID, folder_id: null },
			1
		);
		expect(moved.link.folder_id).toBeNull();

		await client.documents.delete(documentId, 3);
		const restored = await client.documents.restore(documentId, 3);
		expect(restored.document.version).toBe(4);
	});

	it('supports payment list/create/get/allocate/reverse with Idempotency-Key and If-Match', async () => {
		const paymentId = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
		const clientId = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
		const invoiceId = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';

		const samplePayment = (overrides: Record<string, unknown> = {}) => ({
			id: paymentId,
			org_id: ORG_A,
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			version: 1,
			direction: 'inbound',
			client_id: clientId,
			vendor_id: null,
			amount_cents: 1200,
			currency: 'GBP',
			method: 'bank',
			status: 'allocated',
			occurred_on: '2026-03-18',
			reference: null,
			provider: 'manual',
			provider_payment_id: null,
			notes: null,
			reverses_payment_id: null,
			completed_at: '2026-03-18T12:00:00Z',
			metadata: {},
			allocations: [
				{
					id: 'dddddddd-dddd-4eee-8fff-000000000001',
					org_id: ORG_A,
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-01T00:00:00Z',
					created_by: null,
					updated_by: null,
					version: 1,
					payment_id: paymentId,
					invoice_id: invoiceId,
					bill_id: null,
					amount_cents: 1200,
					allocated_at: '2026-03-18T12:00:00Z',
					reversed_at: null,
					reversal_reason: null,
					invoice_number: 'INV-0001'
				}
			],
			...overrides
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/payments': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const url = new URL(request.url);
				expect(url.searchParams.get('invoice_id')).toBe(invoiceId);
				expect(url.searchParams.get('bill_id')).toBeNull();
				return { body: { data: [samplePayment()], meta: { next_cursor: null } } };
			},
			'POST /api/v1/payments': async (request) => {
				expect(request.headers.get('idempotency-key')).toBeTruthy();
				expect(await request.json()).toMatchObject({
					direction: 'inbound',
					client_id: clientId,
					amount_cents: 1200,
					provider: 'manual'
				});
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: { data: samplePayment() }
				};
			},
			[`GET /api/v1/payments/${paymentId}`]: async () => ({
				headers: { etag: '"1"' },
				body: { data: samplePayment() }
			}),
			[`POST /api/v1/payments/${paymentId}/allocate`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				expect(request.headers.get('idempotency-key')).toBeTruthy();
				return {
					headers: { etag: '"2"' },
					body: { data: samplePayment({ version: 2, status: 'allocated' }) }
				};
			},
			[`POST /api/v1/payments/${paymentId}/reverse`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				expect(await request.json()).toEqual({ reason: 'Correction' });
				return {
					headers: { etag: '"3"' },
					body: { data: samplePayment({ version: 3, status: 'reversed' }) }
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await client.payments.list({ limit: 20, invoice_id: invoiceId });
		expect(listed.data).toHaveLength(1);

		const created = await client.payments.create({
			direction: 'inbound',
			client_id: clientId,
			amount_cents: 1200,
			currency: 'GBP',
			method: 'bank',
			occurred_on: '2026-03-18',
			provider: 'manual',
			allocations: [{ invoice_id: invoiceId, amount_cents: 1200 }]
		});
		expect(created.id).toBe(paymentId);

		const got = await client.payments.get(paymentId);
		expect(got.data.allocations).toHaveLength(1);

		const allocated = await client.payments.allocate(
			paymentId,
			{ allocations: [{ invoice_id: invoiceId, amount_cents: 1200 }] },
			1
		);
		expect(allocated.version).toBe(2);

		const reversed = await client.payments.reverse(paymentId, { reason: 'Correction' }, 2);
		expect(reversed.status).toBe('reversed');
	});
});
