import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import PaymentsPage from './payments-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PAYMENT_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';

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
		tax_exempt: false,
		registration_number: null,
		default_currency: 'GBP',
		payment_terms_days: null,
		renewal_on: null,
		notes: null,
		metadata: {}
	};
}

function samplePayment(overrides: Record<string, unknown> = {}) {
	return {
		id: PAYMENT_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		version: 1,
		direction: 'inbound',
		client_id: CLIENT_ID,
		vendor_id: null,
		amount_cents: 1200,
		currency: 'GBP',
		method: 'bank',
		status: 'unallocated',
		occurred_on: '2026-03-18',
		reference: null,
		provider: 'manual',
		provider_payment_id: null,
		notes: null,
		reverses_payment_id: null,
		completed_at: null,
		metadata: {},
		allocations: [],
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

describe('PaymentsPage integration', () => {
	it('lists payments with X-Org-Id and records an inbound payment', async () => {
		await page.viewport(1280, 720);
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;

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
					membership_id: 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm',
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/payments': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [samplePayment()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/vendors': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/invoices': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/bills': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'POST /api/v1/payments': async (request) => {
				expect(request.headers.get('idempotency-key')).toBeTruthy();
				createBody = await request.json();
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: {
						data: samplePayment({
							id: '22222222-3333-4444-8555-666666666666',
							amount_cents: 2500,
							status: 'unallocated',
							allocations: []
						})
					}
				};
			}
		});

		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => session.selectedOrgId
		});

		render(PaymentsPage, { api, session });

		await expect.element(page.getByTestId('payments-page')).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Northwind' })).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'Record payment' }).click();
		await page.getByLabelText('Amount').fill('25.00');
		await page.getByTestId('payment-form').getByRole('button', { name: 'Save payment' }).click();

		await expect
			.poll(() => createBody)
			.toMatchObject({
				direction: 'inbound',
				client_id: CLIENT_ID,
				amount_cents: 2500,
				provider: 'manual'
			});
	});
});
