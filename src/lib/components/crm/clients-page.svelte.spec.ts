import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import ClientsPage from './clients-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';

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

describe('ClientsPage integration', () => {
	it('lists clients with X-Org-Id and creates a client', async () => {
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
			'GET /api/v1/clients': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return {
					body: {
						data: [
							sampleClient({
								contacts: [
									{
										id: '22222222-3333-4444-8555-666666666666',
										display_name: 'Ava Chen',
										primary_email: 'ava@northwind.com',
										role: 'primary',
										is_primary: true
									}
								]
							})
						],
						meta: { next_cursor: null }
					}
				};
			},
			'POST /api/v1/clients': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleClient({
							id: '22222222-3333-4444-8555-666666666666',
							name: 'Adventure Works'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(ClientsPage, { api, session });

		await expect.element(page.getByRole('link', { name: 'Northwind' })).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		const personLink = page.getByRole('link', { name: 'Ava Chen' });
		await expect
			.element(personLink)
			.toHaveAttribute('href', '/contacts/22222222-3333-4444-8555-666666666666');

		await page.getByRole('button', { name: 'New client' }).click();
		await page.getByLabelText('Name').fill('Adventure Works');
		await page.getByTestId('client-form').getByRole('button', { name: 'Save client' }).click();

		await expect.element(page.getByRole('link', { name: 'Adventure Works' })).toBeInTheDocument();
		expect(createBody).toMatchObject({
			name: 'Adventure Works',
			status: 'active',
			default_currency: 'GBP'
		});
	});
});
