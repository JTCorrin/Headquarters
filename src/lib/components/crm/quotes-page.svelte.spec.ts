import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import QuotesPage from './quotes-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const QUOTE_ID = '11111111-2222-4333-8444-555555555555';

function sampleQuote(overrides: Record<string, unknown> = {}) {
	return {
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
		status: 'draft',
		currency: 'GBP',
		issue_on: '2026-01-01',
		valid_until: null,
		subtotal_cents: 0,
		discount_cents: 0,
		tax_cents: 0,
		total_cents: 0,
		party_snapshot: { name: 'Northwind' },
		terms: null,
		notes: null,
		internal_notes: null,
		sent_at: null,
		viewed_at: null,
		accepted_at: null,
		rejected_at: null,
		converted_invoice_id: null,
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

describe('QuotesPage integration', () => {
	it('lists draft quotes with X-Org-Id and creates a quote', async () => {
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
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/quotes': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleQuote()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/clients': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return {
					body: {
						data: [
							{
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
							}
						],
						meta: { next_cursor: null }
					}
				};
			},
			'GET /api/v1/contacts': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'POST /api/v1/quotes': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleQuote({
							id: '22222222-3333-4444-8555-666666666666',
							number: 'Q-0002',
							title: 'New retainer'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(QuotesPage, { api, session });

		await expect.element(page.getByRole('link', { name: 'Q-0001' })).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'New quote' }).click();
		await page.getByLabelText('Title').fill('New retainer');
		await page.getByTestId('quote-form').getByRole('button', { name: 'Save quote' }).click();

		await expect.element(page.getByRole('link', { name: 'Q-0002' })).toBeInTheDocument();
		expect(createBody).toMatchObject({
			title: 'New retainer',
			client_id: CLIENT_ID,
			currency: 'GBP',
			contact_id: null,
			recipients: [],
			lines: []
		});
	});
});
