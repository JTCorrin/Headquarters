import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { apiError, createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import SelectOrgPage from './select-org-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORG_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function discoveryBody() {
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
					role: 'member',
					status: 'active',
					joined_at: '2026-02-01T00:00:00Z'
				},
				organisation: {
					id: ORG_B,
					name: 'Certivue',
					slug: 'certivue',
					logo_path: null,
					default_currency: 'USD',
					timezone: 'America/New_York',
					locale: 'en-US',
					country_code: 'US',
					theme_default: 'dark'
				}
			}
		]
	};
}

describe('SelectOrgPage integration', () => {
	it('discovers memberships and selects an organisation', async () => {
		const storage = {
			store: new Map<string, string>(),
			getItem(key: string) {
				return this.store.get(key) ?? null;
			},
			setItem(key: string, value: string) {
				this.store.set(key, value);
			},
			removeItem(key: string) {
				this.store.delete(key);
			}
		};
		const session = createOrgSession({ storage });
		const onSelected = vi.fn();
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisations': async () => ({ body: discoveryBody() })
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(SelectOrgPage, { api, session, onSelected });

		await expect.element(page.getByTestId(`select-org-${ORG_A}`)).toBeInTheDocument();
		await page.getByTestId(`select-org-${ORG_B}`).click();
		await vi.waitFor(() => expect(session.selectedOrgId).toBe(ORG_B));
		expect(onSelected).toHaveBeenCalledWith(ORG_B);
		expect(storage.getItem('hq.selected-org-id')).toBe(ORG_B);
		expect(session.cacheGeneration).toBe(1);
	});

	it('surfaces network failure on discovery', async () => {
		const session = createOrgSession({
			storage: {
				getItem: () => null,
				setItem: () => undefined,
				removeItem: () => undefined
			}
		});
		const api = createApiV1Client({
			fetch: async () => {
				throw new TypeError('Failed to fetch');
			},
			getOrgId: () => null
		});

		render(SelectOrgPage, { api, session });
		await expect.element(page.getByText(/network error/i)).toBeInTheDocument();
	});

	it('surfaces 422 on create', async () => {
		const session = createOrgSession({
			storage: {
				getItem: () => null,
				setItem: () => undefined,
				removeItem: () => undefined
			}
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisations': async () => ({ body: { data: [] } }),
				'POST /api/v1/organisations': async () =>
					apiError(422, 'VALIDATION_ERROR', 'Organisation validation failed', {
						slug: 'Must be a lowercase kebab-case slug'
					})
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(SelectOrgPage, { api, session });
		await page.getByTestId('select-org-create').click();
		await page.getByLabelText(/^name$/i).fill('Bad Org');
		await page.getByLabelText(/^slug$/i).fill('taken-slug');
		// Fill remaining required selects if empty defaults are already valid.
		await page.getByTestId('organisation-create-submit').click();
		await expect
			.element(page.getByTestId('organisation-create-error'))
			.toHaveTextContent(/kebab-case|slug|could not create/i);
	});
});
