import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { apiError, createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import OrgConfigPage from './org-config-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORG_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function orgConfig(version = 2, currency = 'GBP') {
	return {
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
		default_currency: currency,
		timezone: 'Europe/London',
		locale: 'en-GB',
		country_code: 'GB',
		theme_default: 'system',
		settings: {},
		version,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		deleted_at: null
	};
}

function memberships() {
	return {
		data: [
			{
				membership: {
					id: 'm1',
					role: 'owner',
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
					theme_default: 'system'
				}
			},
			{
				membership: {
					id: 'm2',
					role: 'admin',
					status: 'active',
					joined_at: '2026-02-01T00:00:00Z'
				},
				organisation: {
					id: ORG_B,
					name: 'Certivue',
					slug: 'certivue',
					logo_path: null,
					default_currency: 'USD',
					timezone: 'UTC',
					locale: 'en-US',
					country_code: 'US',
					theme_default: 'dark'
				}
			}
		]
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

describe('OrgConfigPage integration', () => {
	it('loads config/tax/preferences with X-Org-Id and saves preferences', async () => {
		const seenOrgHeaders: string[] = [];
		let prefsBody: unknown;
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisations': async () => ({ body: memberships() }),
				'GET /api/v1/organisation/configuration': async (request) => {
					seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
					return { headers: { etag: '"2"' }, body: { data: orgConfig(2) } };
				},
				'GET /api/v1/tax-rates': async (request) => {
					seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
					return {
						body: {
							data: [
								{
									id: 'tax-1',
									org_id: ORG_A,
									created_at: '2026-01-01T00:00:00Z',
									updated_at: '2026-01-01T00:00:00Z',
									created_by: null,
									updated_by: null,
									deleted_at: null,
									version: 1,
									name: 'VAT 20%',
									rate_percent: 20,
									is_default: true,
									active: true
								}
							]
						}
					};
				},
				'GET /api/v1/profile/preferences': async (request) => {
					expect(request.headers.get('x-org-id')).toBeNull();
					return { body: { data: { theme_preference: null, locale: null, timezone: null } } };
				},
				'PATCH /api/v1/profile/preferences': async (request) => {
					prefsBody = await request.json();
					return {
						body: { data: { theme_preference: 'dark', locale: null, timezone: null } }
					};
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });

		await expect.element(page.getByText('VAT 20%')).toBeInTheDocument();
		expect(seenOrgHeaders.every((h) => h === ORG_A)).toBe(true);

		await page.getByTestId('profile-theme-trigger').click();
		await page.getByRole('option', { name: 'Dark' }).click();
		await page.getByRole('button', { name: /save preference/i }).click();
		await vi.waitFor(() => expect(prefsBody).toEqual({ theme_preference: 'dark' }));
	});

	it('surfaces 403 on configuration load', async () => {
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					role: 'owner'
				}
			]
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisation/configuration': async () =>
					apiError(403, 'FORBIDDEN', 'No active membership for this organisation'),
				'GET /api/v1/tax-rates': async () => ({ body: { data: [] } }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				})
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await expect.element(page.getByText(/403/i)).toBeInTheDocument();
	});

	it('surfaces 412 conflict on config save', async () => {
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					role: 'owner'
				}
			]
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisation/configuration': async () => ({
					headers: { etag: '"2"' },
					body: { data: orgConfig(2) }
				}),
				'GET /api/v1/tax-rates': async () => ({ body: { data: [] } }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: 'system', locale: null, timezone: null } }
				}),
				'PATCH /api/v1/organisation/configuration': async () =>
					apiError(412, 'PRECONDITION_FAILED', 'Organisation version does not match If-Match')
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await expect.element(page.getByTestId('organisation-config-form')).toBeInTheDocument();
		await page.getByTestId('organisation-config-submit').click();
		await expect.element(page.getByText(/412/i)).toBeInTheDocument();
	});

	it('resets org-scoped state and bumps cache generation on switch', async () => {
		let configHits = 0;
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: memberships().data.map((row) => ({
				org_id: row.organisation.id,
				org_name: row.organisation.name,
				org_slug: row.organisation.slug,
				role: row.membership.role as 'owner' | 'admin' | 'member' | 'billing' | 'readonly'
			}))
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisation/configuration': async (request) => {
					configHits += 1;
					const orgId = request.headers.get('x-org-id');
					return {
						headers: { etag: '"1"' },
						body: {
							data: {
								...orgConfig(1, orgId === ORG_B ? 'USD' : 'GBP'),
								id: orgId ?? ORG_A,
								name: orgId === ORG_B ? 'Certivue' : 'Corrin Data',
								slug: orgId === ORG_B ? 'certivue' : 'corrin-data'
							}
						}
					};
				},
				'GET /api/v1/tax-rates': async () => ({ body: { data: [] } }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				})
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await expect.element(page.getByTestId('org-switcher-trigger')).toBeInTheDocument();
		const generationBefore = session.cacheGeneration;

		await page.getByTestId('org-switcher-trigger').click();
		await page.getByTestId(`org-switch-${ORG_B}`).click();

		await vi.waitFor(() => expect(session.selectedOrgId).toBe(ORG_B));
		expect(session.cacheGeneration).toBe(generationBefore + 1);
		await vi.waitFor(() => expect(configHits).toBeGreaterThanOrEqual(2));
		await expect.element(page.getByTestId('org-switcher-trigger')).toHaveTextContent(/Certivue/i);
	});

	it('surfaces 422 when tax create fails validation', async () => {
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					role: 'owner'
				}
			]
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisation/configuration': async () => ({
					body: { data: orgConfig(2) }
				}),
				'GET /api/v1/tax-rates': async () => ({ body: { data: [] } }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				}),
				'POST /api/v1/tax-rates': async () =>
					apiError(422, 'VALIDATION_ERROR', 'Tax rate validation failed', {
						name: 'Must be a non-empty string up to 120 characters'
					})
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await page.getByTestId('tax-rate-add').click();
		await page.getByLabelText(/^name$/i).fill('X');
		await page.getByTestId('tax-rate-submit').click();
		await expect.element(page.getByTestId('tax-rate-save-error')).toBeInTheDocument();
	});
});
