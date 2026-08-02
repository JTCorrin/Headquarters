import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import InvoicesPage from './invoices-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const INVOICE_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';

function sampleInvoice(overrides: Record<string, unknown> = {}) {
	return {
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
		source: 'manual',
		recurring_run_id: null,
		billing_period_start: null,
		billing_period_end: null,
		status: 'draft',
		currency: 'GBP',
		issue_on: '2026-03-01',
		due_on: '2026-04-01',
		purchase_order_number: null,
		subtotal_cents: 0,
		discount_cents: 0,
		tax_cents: 0,
		total_cents: 0,
		paid_cents: 0,
		balance_due_cents: 0,
		party_snapshot: { name: 'Northwind' },
		payment_terms: null,
		notes: null,
		internal_notes: null,
		sent_at: null,
		viewed_at: null,
		paid_at: null,
		voided_at: null,
		void_reason: null,
		lines: [],
		...overrides
	};
}

function sampleClient() {
	return {
		id: CLIENT_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Northwind',
		status: 'active',
		website_url: null,
		industry: null,
		primary_email: null,
		phone: null,
		tax_identifier: null,
		registration_number: null,
		default_currency: 'GBP',
		payment_terms_days: null,
		owner_membership_id: null,
		converted_from_lead_id: null,
		renewal_on: null,
		notes: null,
		metadata: {}
	};
}

function memoryStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, value);
		},
		removeItem: (key: string) => {
			map.delete(key);
		}
	};
}

describe('InvoicesPage integration', () => {
	it('lists draft invoices with X-Org-Id and creates a blank draft', async () => {
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;
		let createdId: string | null = null;

		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					logo_url: null,
					role: 'owner',
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/invoices': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				expect(new URL(request.url, 'http://local').searchParams.get('status')).toBeNull();
				return {
					body: {
						data: [
							sampleInvoice(),
							sampleInvoice({
								id: '33333333-3333-4444-8555-666666666666',
								number: 'INV-0003',
								status: 'sent'
							}),
							sampleInvoice({
								id: '44444444-4444-4555-8666-777777777777',
								number: 'INV-0004',
								status: 'void'
							})
						],
						meta: { next_cursor: null }
					}
				};
			},
			'GET /api/v1/clients': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleClient()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/contacts': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/quotes': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'POST /api/v1/invoices': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleInvoice({
							id: '22222222-3333-4444-8555-666666666666',
							number: 'INV-0002'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(InvoicesPage, {
			api,
			session,
			onCreated: (id: string) => {
				createdId = id;
			}
		});

		await expect.element(page.getByRole('link', { name: 'INV-0001' })).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'INV-0003' })).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'INV-0004' })).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'New invoice' }).click();
		await page.getByTestId('invoice-form').getByRole('button', { name: 'Save invoice' }).click();

		await expect.element(page.getByRole('link', { name: 'INV-0002' })).toBeInTheDocument();
		expect(createBody).toMatchObject({
			client_id: CLIENT_ID,
			currency: 'GBP',
			lines: []
		});
		expect(createdId).toBe('22222222-3333-4444-8555-666666666666');
	});
});
