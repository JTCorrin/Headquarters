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
		logo_url: null,
		billing_email: null,
		phone: null,
		website_url: null,
		tax_identifier: null,
		registration_number: null,
		address_line1: null,
		address_line2: null,
		city: null,
		region: null,
		postal_code: null,
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
					role: 'owner',
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
	it('loads config/tax with X-Org-Id and keeps personal Mail off org Config', async () => {
		const seenOrgHeaders: string[] = [];
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
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });

		await expect.element(page.getByText('VAT 20%')).toBeInTheDocument();
		expect(seenOrgHeaders.every((h) => h === ORG_A)).toBe(true);
		expect(page.getByTestId('personal-mail-section').elements().length).toBe(0);
		expect(page.getByTestId('personal-theme-section').elements().length).toBe(0);
	});

	it('blocks non-owners from org Config with a My settings link', async () => {
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					role: 'admin',
					theme_default: 'system'
				}
			]
		});
		const api = createApiV1Client({
			fetch: createMockFetch({}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await expect.element(page.getByTestId('org-config-forbidden')).toBeInTheDocument();
		await expect
			.element(page.getByTestId('org-config-forbidden').getByRole('link'))
			.toHaveAttribute('href', '/settings');
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
					role: 'owner',
					theme_default: 'system'
				}
			]
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisation/configuration': async () =>
					apiError(403, 'FORBIDDEN', 'No active membership for this organisation'),
				'GET /api/v1/tax-rates': async () => ({ body: { data: [] } })
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
					role: 'owner',
					theme_default: 'system'
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
				'PATCH /api/v1/organisation/configuration': async () =>
					apiError(412, 'PRECONDITION_FAILED', 'Organisation version does not match If-Match')
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await expect.element(page.getByTestId('organisation-config-form')).toBeInTheDocument();
		await expect.element(page.getByTestId('org-company-details-section')).toBeInTheDocument();
		await expect.element(page.getByLabelText('Address line 1')).toBeInTheDocument();
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
				role: row.membership.role as 'owner' | 'admin' | 'member' | 'billing' | 'readonly',
				theme_default: row.organisation.theme_default
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

	it('discards a delayed config save that completes after org switch', async () => {
		let releaseSave: (() => void) | undefined;
		const saveGate = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		let patchCompletions = 0;

		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: memberships().data.map((row) => ({
				org_id: row.organisation.id,
				org_name: row.organisation.name,
				org_slug: row.organisation.slug,
				role: row.membership.role as 'owner' | 'admin' | 'member' | 'billing' | 'readonly',
				theme_default: row.organisation.theme_default
			}))
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisation/configuration': async (request) => {
					const orgId = request.headers.get('x-org-id');
					return {
						headers: { etag: '"1"' },
						body: {
							data: {
								...orgConfig(1, orgId === ORG_B ? 'USD' : 'GBP'),
								id: orgId ?? ORG_A,
								name: orgId === ORG_B ? 'Certivue' : 'Corrin Data',
								slug: orgId === ORG_B ? 'certivue' : 'corrin-data',
								default_currency: orgId === ORG_B ? 'USD' : 'GBP'
							}
						}
					};
				},
				'GET /api/v1/tax-rates': async () => ({ body: { data: [] } }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				}),
				'PATCH /api/v1/organisation/configuration': async (request) => {
					await saveGate;
					patchCompletions += 1;
					const orgId = request.headers.get('x-org-id');
					return {
						headers: { etag: '"2"' },
						body: {
							data: {
								...orgConfig(2, 'EUR'),
								id: orgId ?? ORG_A,
								name: 'Stale Patch Org',
								default_currency: 'EUR'
							}
						}
					};
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await expect.element(page.getByTestId('organisation-config-form')).toBeInTheDocument();
		await page.getByLabelText(/default currency/i).fill('EUR');
		await page.getByTestId('organisation-config-submit').click();
		await expect.element(page.getByTestId('organisation-config-submit')).toHaveTextContent(/Saving/i);

		// Switch while PATCH is gated — exercises epoch discard without UI overlay races.
		session.selectOrg(ORG_B);
		await vi.waitFor(() => expect(session.selectedOrgId).toBe(ORG_B));
		await expect.element(page.getByTestId('org-switcher-trigger')).toHaveTextContent(/Certivue/i);
		await expect.element(page.getByLabelText(/default currency/i)).toHaveValue('USD');

		releaseSave?.();
		await vi.waitFor(() => expect(patchCompletions).toBe(1));
		// Stale EUR patch from org A must not stick on org B (resync after discard).
		await vi.waitFor(async () => {
			await expect.element(page.getByLabelText(/default currency/i)).toHaveValue('USD');
		});
		await expect.element(page.getByTestId('org-switcher-trigger')).toHaveTextContent(/Certivue/i);
	});

	it('discards a delayed tax create that completes after org switch', async () => {
		let releaseCreate: (() => void) | undefined;
		const createGate = new Promise<void>((resolve) => {
			releaseCreate = resolve;
		});
		let createCompletions = 0;

		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: memberships().data.map((row) => ({
				org_id: row.organisation.id,
				org_name: row.organisation.name,
				org_slug: row.organisation.slug,
				role: row.membership.role as 'owner' | 'admin' | 'member' | 'billing' | 'readonly',
				theme_default: row.organisation.theme_default
			}))
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisation/configuration': async (request) => {
					const orgId = request.headers.get('x-org-id');
					return {
						body: {
							data: {
								...orgConfig(1),
								id: orgId ?? ORG_A,
								name: orgId === ORG_B ? 'Certivue' : 'Corrin Data'
							}
						}
					};
				},
				'GET /api/v1/tax-rates': async () => ({ body: { data: [] } }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				}),
				'POST /api/v1/tax-rates': async () => {
					await createGate;
					createCompletions += 1;
					return {
						status: 201,
						body: {
							data: {
								id: 'tax-stale',
								org_id: ORG_A,
								created_at: '2026-01-01T00:00:00Z',
								updated_at: '2026-01-01T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								name: 'Stale VAT',
								rate_percent: 20,
								is_default: false,
								active: true
							}
						}
					};
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(OrgConfigPage, { api, session });
		await page.getByTestId('tax-rate-add').click();
		await page.getByLabelText(/^name$/i).fill('Stale VAT');
		await page.getByTestId('tax-rate-submit').click();
		await expect.element(page.getByTestId('tax-rate-submit')).toHaveTextContent(/Saving/i);

		session.selectOrg(ORG_B);
		await vi.waitFor(() => expect(session.selectedOrgId).toBe(ORG_B));
		await expect.element(page.getByTestId('org-switcher-trigger')).toHaveTextContent(/Certivue/i);
		await expect.element(page.getByTestId('tax-rates-empty')).toBeInTheDocument();

		releaseCreate?.();
		await vi.waitFor(() => expect(createCompletions).toBe(1));
		await expect.element(page.getByTestId('tax-rates-empty')).toBeInTheDocument();
		await expect.element(page.getByText('Stale VAT')).not.toBeInTheDocument();
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
					role: 'owner',
					theme_default: 'system'
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
