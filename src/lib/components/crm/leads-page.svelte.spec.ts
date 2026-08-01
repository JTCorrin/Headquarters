import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import LeadsPage from './leads-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LEAD_ID = '11111111-2222-4333-8444-555555555555';

function sampleLead(overrides: Record<string, unknown> = {}) {
	return {
		id: LEAD_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Contoso expansion',
		company_name: 'Contoso',
		contact_id: null,
		client_id: null,
		stage: 'new',
		value_cents: 250000,
		currency: 'GBP',
		probability_percent: 40,
		source: null,
		owner_membership_id: null,
		expected_close_on: null,
		lost_reason: null,
		won_at: null,
		lost_at: null,
		converted_at: null,
		position: 0,
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

describe('LeadsPage integration', () => {
	it('lists leads with X-Org-Id and creates a lead', async () => {
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
			'GET /api/v1/leads': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleLead()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/organisation/configuration': async () => ({
				body: {
					data: {
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
						timezone: 'UTC',
						locale: 'en-GB',
						country_code: 'GB',
						theme_default: 'system',
						settings: {},
						version: 1,
						created_at: '2026-01-01T00:00:00Z',
						updated_at: '2026-01-01T00:00:00Z',
						deleted_at: null
					}
				}
			}),
			'POST /api/v1/leads': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleLead({
							id: '22222222-3333-4444-8555-666666666666',
							name: 'Northwind pilot'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(LeadsPage, { api, session });

		await expect.element(page.getByText('Contoso expansion')).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'New lead' }).click();
		await page.getByLabelText('Name').fill('Northwind pilot');
		await page.getByTestId('lead-form').getByRole('button', { name: 'Save lead' }).click();

		await expect.element(page.getByText('Northwind pilot')).toBeInTheDocument();
		expect(createBody).toMatchObject({
			name: 'Northwind pilot',
			stage: 'new',
			currency: 'GBP'
		});
	});
});
