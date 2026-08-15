import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import ClientPage from './client-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const INVOICE_ID = '22222222-2222-4222-8222-222222222222';
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333';

function sampleClient(overrides: Record<string, unknown> = {}) {
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
		industry: 'Logistics',
		primary_email: 'billing@northwind.com',
		phone: null,
		tax_identifier: null,
		tax_exempt: false,
		registration_number: null,
		default_currency: 'GBP',
		payment_terms_days: 30,
		owner_membership_id: null,
		converted_from_lead_id: null,
		renewal_on: null,
		notes: null,
		metadata: {},
		...overrides
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

describe('ClientPage money tab', () => {
	it('loads quotes, invoices, and payments with client_id and links document rows', async () => {
		const quoteQueries: string[] = [];
		const invoiceQueries: string[] = [];
		const paymentQueries: string[] = [];

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
			[`GET /api/v1/clients/${CLIENT_ID}`]: async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				return { body: { data: sampleClient() } };
			},
			'GET /api/v1/quotes': async (request) => {
				const url = new URL(request.url);
				quoteQueries.push(url.searchParams.get('client_id') ?? '');
				return {
					body: {
						data: [
							{
								id: QUOTE_ID,
								org_id: ORG_A,
								created_at: '2026-01-01T00:00:00Z',
								updated_at: '2026-01-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								number: 'Q-0140',
								title: 'Annual',
								client_id: CLIENT_ID,
								lead_id: null,
								contact_id: null,
								owner_membership_id: null,
								status: 'accepted',
								currency: 'GBP',
								issue_on: '2026-01-08',
								valid_until: null,
								subtotal_cents: 1800000,
								discount_cents: 0,
								tax_cents: 0,
								total_cents: 1800000,
								party_snapshot: null,
								terms: null,
								notes: null,
								internal_notes: null,
								sent_at: null,
								viewed_at: null,
								accepted_at: null,
								rejected_at: null,
								converted_invoice_id: null
							}
						]
					}
				};
			},
			'GET /api/v1/invoices': async (request) => {
				const url = new URL(request.url);
				invoiceQueries.push(url.searchParams.get('client_id') ?? '');
				return {
					body: {
						data: [
							{
								id: INVOICE_ID,
								org_id: ORG_A,
								created_at: '2026-02-01T00:00:00Z',
								updated_at: '2026-02-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								number: 'INV-0875',
								client_id: CLIENT_ID,
								contact_id: null,
								quote_id: null,
								owner_membership_id: null,
								source: 'manual',
								recurring_run_id: null,
								billing_period_start: null,
								billing_period_end: null,
								status: 'paid',
								currency: 'GBP',
								issue_on: '2026-02-01',
								due_on: '2026-03-01',
								purchase_order_number: null,
								subtotal_cents: 450000,
								discount_cents: 0,
								tax_cents: 0,
								total_cents: 450000,
								paid_cents: 450000,
								balance_due_cents: 0,
								party_snapshot: null,
								payment_terms: null,
								notes: null,
								internal_notes: null,
								sent_at: null,
								voided_at: null,
								void_reason: null
							}
						]
					}
				};
			},
			'GET /api/v1/payments': async (request) => {
				const url = new URL(request.url);
				paymentQueries.push(
					`${url.searchParams.get('client_id') ?? ''}|${url.searchParams.get('direction') ?? ''}`
				);
				return {
					body: {
						data: [
							{
								id: PAYMENT_ID,
								org_id: ORG_A,
								created_at: '2026-02-03T00:00:00Z',
								updated_at: '2026-02-03T00:00:00Z',
								created_by: null,
								updated_by: null,
								version: 1,
								direction: 'inbound',
								client_id: CLIENT_ID,
								vendor_id: null,
								amount_cents: 450000,
								currency: 'GBP',
								method: 'bank',
								status: 'allocated',
								occurred_on: '2026-02-03',
								reference: 'INV-0875',
								provider: null,
								provider_payment_id: null,
								notes: null,
								reverses_payment_id: null,
								completed_at: null,
								metadata: null
							}
						]
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(ClientPage, { api, session, clientId: CLIENT_ID });

		await expect.element(page.getByRole('heading', { name: 'Northwind' })).toBeInTheDocument();
		await page.getByRole('tab', { name: 'Money' }).click();

		await expect.element(page.getByText('Q-0140 · Annual')).toBeInTheDocument();
		await expect.element(page.getByText('INV-0875', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('Bank · INV-0875')).toBeInTheDocument();

		const quoteLink = page.getByRole('link', { name: /Q-0140 · Annual/ });
		await expect.element(quoteLink).toHaveAttribute('href', `/quotes/${QUOTE_ID}`);
		const invoiceLink = page.getByRole('link', { name: /INV-0875/ });
		await expect.element(invoiceLink).toHaveAttribute('href', `/invoices/${INVOICE_ID}`);

		expect(quoteQueries).toEqual([CLIENT_ID]);
		expect(invoiceQueries).toEqual([CLIENT_ID]);
		expect(paymentQueries).toEqual([`${CLIENT_ID}|inbound`]);
	});
});
