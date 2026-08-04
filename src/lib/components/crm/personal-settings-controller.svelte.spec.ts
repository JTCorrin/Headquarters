import { describe, expect, it, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { apiError, createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import { resetMailboxDraftsForTests } from '$lib/personal-settings/mailbox-draft.js';
import PersonalSettingsController from './personal-settings-controller.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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
			}
		]
	};
}

afterEach(() => {
	resetMailboxDraftsForTests();
});

describe('PersonalSettingsController', () => {
	it('retains mailbox draft fields when switching theme and mail tabs', async () => {
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisations': async () => ({ body: memberships() }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				}),
				'GET /api/v1/me/mailbox': async () => apiError(404, 'NOT_FOUND', 'No mailbox'),
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Mail' }).click();
		await page.getByTestId('mailbox-email').fill('draft@acme.test');
		await page.getByTestId('mailbox-username').fill('draft-user');

		await page.getByRole('tab', { name: 'Theme' }).click();
		await expect.element(page.getByTestId('profile-preferences-form')).toBeInTheDocument();

		await page.getByRole('tab', { name: 'Mail' }).click();
		await expect.element(page.getByTestId('mailbox-email')).toHaveValue('draft@acme.test');
		await expect.element(page.getByTestId('mailbox-username')).toHaveValue('draft-user');
	});

	it('surfaces mailbox test connection success and failure', async () => {
		let testCalls = 0;
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisations': async () => ({ body: memberships() }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				}),
				'GET /api/v1/me/mailbox': async () => ({
					body: {
						data: {
							id: 'mb-1',
							email_address: 'joe@acme.test',
							username: 'joe@acme.test',
							from_name: 'Joe',
							imap_host: 'imap.gmail.com',
							imap_port: 993,
							imap_security: 'tls',
							smtp_host: 'smtp.gmail.com',
							smtp_port: 465,
							smtp_security: 'tls',
							credentials_configured: true,
							status: 'configured',
							last_checked_at: null,
							last_error_code: null
						}
					}
				}),
				'POST /api/v1/me/mailbox/test': async () => {
					testCalls += 1;
					if (testCalls === 1) {
						return { body: { data: { ok: true, message: 'Credentials look valid.' } } };
					}
					return {
						body: {
							data: { ok: false, message: 'Missing saved credentials.', error_code: 'no_credentials' }
						}
					};
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Mail' }).click();
		await page.getByTestId('mailbox-test').click();
		await expect.element(page.getByTestId('mailbox-test-feedback')).toHaveTextContent(
			/Credentials look valid/i
		);

		await page.getByTestId('mailbox-test').click();
		await expect.element(page.getByTestId('mailbox-test-feedback')).toHaveTextContent(
			/Missing saved credentials/i
		);
	});

	it('renders Calendar tab disconnected and calls OAuth start on Connect', async () => {
		let oauthStarts = 0;
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisations': async () => ({ body: memberships() }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				}),
				'GET /api/v1/me/mailbox': async () => apiError(404, 'NOT_FOUND', 'No mailbox'),
				'GET /api/v1/me/calendar': async () => ({
					body: {
						data: {
							provider: null,
							status: 'disconnected',
							credentials_configured: false,
							config: null,
							last_error_code: null,
							last_checked_at: null
						}
					}
				}),
				'GET /api/v1/me/calendar/oauth/start': async () => {
					oauthStarts += 1;
					// Empty URL surfaces a readable error without navigating the browser.
					return { body: { data: { authorize_url: '', state: 'test' } } };
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Calendar' }).click();
		await expect.element(page.getByTestId('personal-calendar-section')).toBeInTheDocument();
		await expect.element(page.getByTestId('calendar-connection-label')).toHaveTextContent(
			/Not connected/i
		);
		await expect.element(page.getByTestId('calendar-connect')).toBeInTheDocument();

		await page.getByTestId('calendar-connect').click();
		await expect.poll(() => oauthStarts).toBe(1);
		await expect.element(page.getByTestId('calendar-connect-error')).toHaveTextContent(
			/did not return a redirect URL/i
		);
	});

	it('renders connected Calendar status from GET /me/calendar', async () => {
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A
		});
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/organisations': async () => ({ body: memberships() }),
				'GET /api/v1/profile/preferences': async () => ({
					body: { data: { theme_preference: null, locale: null, timezone: null } }
				}),
				'GET /api/v1/me/mailbox': async () => apiError(404, 'NOT_FOUND', 'No mailbox'),
				'GET /api/v1/me/calendar': async () => ({
					body: {
						data: {
							provider: 'google',
							status: 'active',
							credentials_configured: true,
							config: { email: 'joe@acme.test' },
							last_error_code: null,
							last_checked_at: null
						}
					}
				})
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Calendar' }).click();
		await expect.element(page.getByTestId('calendar-connection-label')).toHaveTextContent(
			/joe@acme.test/i
		);
		await expect.element(page.getByTestId('calendar-disconnect')).toBeInTheDocument();
	});
});
