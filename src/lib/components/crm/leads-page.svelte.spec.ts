import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import LeadsPage from './leads-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LEAD_ID = '11111111-2222-4333-8444-555555555555';
const LEAD_B = '22222222-3333-4444-8555-666666666666';

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
		primary_email: null,
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

const orgConfigBody = {
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
};

function sessionForOrg() {
	return createOrgSession({
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
}

describe('LeadsPage integration', () => {
	it('lists leads with X-Org-Id and creates a lead', async () => {
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;

		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/leads': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleLead()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/organisation/configuration': async () => ({
				body: { data: orgConfigBody }
			}),
			'POST /api/v1/leads': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleLead({
							id: LEAD_B,
							name: 'Northwind pilot'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(LeadsPage, { api, session });

		await expect
			.element(page.getByLabelText('Contoso expansion', { exact: true }))
			.toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'New lead' }).click();
		await page.getByLabelText('Name').fill('Northwind pilot');
		await page.getByTestId('lead-form').getByRole('button', { name: 'Save lead' }).click();

		await expect
			.element(page.getByLabelText('Northwind pilot', { exact: true }))
			.toBeInTheDocument();
		expect(createBody).toMatchObject({
			name: 'Northwind pilot',
			stage: 'new',
			currency: 'GBP'
		});
	});

	it('card move PATCHes stage+position and rolls back visibly on failure', async () => {
		const session = sessionForOrg();
		let patchCount = 0;
		let lastPatch: { body: unknown; ifMatch: string | null } | null = null;

		const boardLeads = [
			sampleLead({ id: LEAD_ID, name: 'Alpha deal', stage: 'new', position: 0, version: 1 }),
			sampleLead({
				id: LEAD_B,
				name: 'Bravo deal',
				stage: 'new',
				position: 1000,
				version: 2
			})
		];

		const fetchMock = createMockFetch({
			'GET /api/v1/leads': async () => ({
				body: { data: boardLeads, meta: { next_cursor: null } }
			}),
			'GET /api/v1/clients': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/organisation/configuration': async () => ({
				body: { data: orgConfigBody }
			}),
			[`PATCH /api/v1/leads/${LEAD_B}`]: async (request) => {
				patchCount += 1;
				lastPatch = {
					body: await request.json(),
					ifMatch: request.headers.get('if-match')
				};
				if (patchCount === 1) {
					return {
						body: {
							data: sampleLead({
								id: LEAD_B,
								name: 'Bravo deal',
								stage: 'new',
								position: -500,
								version: 3
							})
						}
					};
				}
				return {
					status: 409,
					body: {
						error: {
							code: 'CONFLICT',
							message: 'Lead version does not match If-Match'
						}
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(LeadsPage, { api, session });

		await expect
			.element(page.getByLabelText('Bravo deal', { exact: true }))
			.toBeInTheDocument();
		await page.getByTestId(`lead-move-up-${LEAD_B}`).click();

		await expect.poll(() => patchCount).toBe(1);
		expect(lastPatch?.ifMatch).toBe('"2"');
		expect(lastPatch?.body).toMatchObject({
			stage: 'new',
			position: expect.any(Number)
		});

		// Second move fails — board error visible and card still on the board.
		await page.getByTestId(`lead-move-down-${LEAD_B}`).click();
		await expect.poll(() => patchCount).toBe(2);
		await expect
			.element(page.getByTestId('leads-board-error'))
			.toHaveTextContent(/restored|match|conflict|could not move/i);
		await expect
			.element(page.getByLabelText('Bravo deal', { exact: true }))
			.toBeInTheDocument();
	});

	it('toggles Table view from loaded leads and returns to Board view', async () => {
		const session = sessionForOrg();
		const fetchMock = createMockFetch({
			'GET /api/v1/leads': async () => ({
				body: { data: [sampleLead()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/clients': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/organisation/configuration': async () => ({
				body: { data: orgConfigBody }
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(LeadsPage, { api, session });

		await expect
			.element(page.getByLabelText('Contoso expansion', { exact: true }))
			.toBeInTheDocument();

		await page.getByTestId('leads-table-view').click();
		await expect.element(page.getByTestId('leads-table')).toBeInTheDocument();
		const link = page.getByTestId('lead-name-link');
		await expect.element(link).toHaveTextContent('Contoso expansion');
		await expect.element(link).toHaveAttribute('href', `/leads/${LEAD_ID}`);

		await page.getByTestId('leads-board-view').click();
		await expect.element(page.getByTestId('leads-board')).toBeInTheDocument();
		await expect.element(page.getByTestId('leads-table-view')).toBeInTheDocument();
	});
});
