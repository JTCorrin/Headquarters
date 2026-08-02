import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import BillsPage from './bills-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VENDOR_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const BILL_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';

function sampleVendor() {
	return {
		id: VENDOR_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Cloudflare',
		status: 'active',
		primary_email: null,
		phone: null,
		website_url: null,
		tax_identifier: null,
		default_currency: 'GBP',
		payment_terms_days: null,
		notes: null,
		metadata: {}
	};
}

function sampleBill(overrides: Record<string, unknown> = {}) {
	return {
		id: BILL_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		vendor_id: VENDOR_ID,
		number: 'BILL-0001',
		internal_reference: null,
		status: 'draft',
		currency: 'GBP',
		issue_on: null,
		received_on: '2026-03-01',
		due_on: '2026-04-01',
		scheduled_payment_on: null,
		subtotal_cents: 0,
		discount_cents: 0,
		tax_cents: 0,
		total_cents: 0,
		paid_cents: 0,
		balance_due_cents: 0,
		party_snapshot: { name: 'Cloudflare' },
		notes: null,
		attachment_document_id: null,
		paid_at: null,
		voided_at: null,
		void_reason: null,
		lines: [],
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

describe('BillsPage integration', () => {
	it('lists bills with X-Org-Id and creates a draft', async () => {
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
			'GET /api/v1/bills': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return {
					body: {
						data: [
							sampleBill(),
							sampleBill({
								id: '33333333-3333-4444-8555-666666666666',
								number: 'BILL-0003',
								status: 'received'
							}),
							sampleBill({
								id: '44444444-4444-4555-8666-777777777777',
								number: 'BILL-0004',
								status: 'void'
							})
						],
						meta: { next_cursor: null }
					}
				};
			},
			'GET /api/v1/vendors': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleVendor()], meta: { next_cursor: null } } };
			},
			'POST /api/v1/bills': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleBill({
							id: '22222222-3333-4444-8555-666666666666',
							number: 'BILL-0002'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(BillsPage, {
			api,
			session,
			onCreated: (id: string) => {
				createdId = id;
			}
		});

		await expect.element(page.getByRole('link', { name: 'BILL-0001' })).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'BILL-0003' })).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'BILL-0004' })).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'New bill' }).click();
		await page.getByLabelText('Vendor bill number').fill('BILL-0002');
		await page.getByTestId('bill-form').getByRole('button', { name: 'Save bill' }).click();

		await expect.element(page.getByRole('link', { name: 'BILL-0002' })).toBeInTheDocument();
		expect(createBody).toMatchObject({
			vendor_id: VENDOR_ID,
			number: 'BILL-0002',
			currency: 'GBP',
			lines: []
		});
		expect(createdId).toBe('22222222-3333-4444-8555-666666666666');
	});
});
