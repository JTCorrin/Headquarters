import { describe, expect, it, afterEach, vi } from 'vitest';
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

function disconnectedCalendar(provider: 'google' | 'caldav' = 'google') {
	return {
		provider,
		status: 'disconnected',
		credentials_configured: false,
		config: {},
		last_error_code: null,
		last_sync_at: null
	};
}

/** Provider-aware GET /me/calendar mock — XOR active row vs per-provider rows. */
function calendarGetHandler(options: {
	active?: Record<string, unknown>;
	google?: Record<string, unknown>;
	caldav?: Record<string, unknown>;
}) {
	return async (request: Request) => {
		const provider = new URL(request.url).searchParams.get('provider');
		if (provider === 'google') {
			return { body: { data: options.google ?? disconnectedCalendar('google') } };
		}
		if (provider === 'caldav') {
			return { body: { data: options.caldav ?? disconnectedCalendar('caldav') } };
		}
		return {
			body: {
				data:
					options.active ??
					options.google ??
					options.caldav ??
					disconnectedCalendar('google')
			}
		};
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
		await page.getByTestId('mailbox-preset-trigger').click();
		await page.getByRole('option', { name: 'Custom' }).click();
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

	it('saves the selected mailbox sync interval and shows returned state or errors', async () => {
		const mailboxAccount = {
			id: 'mb-1',
			email_address: 'joe@acme.test',
			username: 'joe@acme.test',
			from_name: 'Joe',
			imap_host: 'imap.gmail.com',
			imap_port: 993,
			imap_security: 'tls' as const,
			smtp_host: 'smtp.gmail.com',
			smtp_port: 465,
			smtp_security: 'tls' as const,
			credentials_configured: true,
			status: 'configured',
			auth_mode: 'password' as const,
			oauth_provider: null,
			last_checked_at: null,
			last_error_code: null,
			sync_interval_minutes: 15
		};
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
				'GET /api/v1/me/mailbox': async () => ({ body: { data: mailboxAccount } })
			}),
			getOrgId: () => session.selectedOrgId
		});
		const updateSyncInterval = vi
			.fn()
			.mockResolvedValueOnce({ ...mailboxAccount, sync_interval_minutes: 30 })
			.mockRejectedValueOnce(new Error('save failed'));
		Object.assign(api.mailbox, { updateSyncInterval });

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Mail' }).click();
		const trigger = page.getByTestId('mailbox-sync-interval-trigger');
		await expect.element(trigger).toHaveTextContent('15 minutes');

		await trigger.click();
		await page.getByRole('option', { name: '30 minutes' }).click();
		await page.getByTestId('mailbox-sync-interval-save').click();

		await expect.poll(() => updateSyncInterval).toHaveBeenCalledWith(30);
		await expect.element(page.getByTestId('mailbox-sync-interval-feedback')).toHaveTextContent(
			/Sync interval saved/i
		);
		await expect.element(trigger).toHaveTextContent('30 minutes');

		await trigger.click();
		await page.getByRole('option', { name: '60 minutes' }).click();
		await page.getByTestId('mailbox-sync-interval-save').click();

		await expect.element(page.getByTestId('mailbox-sync-interval-feedback')).toHaveTextContent(
			/Could not save sync interval/i
		);
	});

	it('shows Connect with Microsoft for Outlook preset and starts mailbox OAuth', async () => {
		let oauthStarts = 0;
		let oauthProvider = '';
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
				'GET /api/v1/me/mailbox/oauth/start': async (request) => {
					oauthStarts += 1;
					oauthProvider = new URL(request.url).searchParams.get('provider') ?? '';
					return { body: { data: { url: '', state: 'mailbox-state', provider: 'microsoft' } } };
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Mail' }).click();
		await page.getByTestId('mailbox-preset-trigger').click();
		await page.getByRole('option', { name: 'Outlook / Microsoft 365' }).click();
		await page.getByTestId('mailbox-oauth-connect').click();
		await expect.element(page.getByTestId('mailbox-oauth-error')).toHaveTextContent(
			/did not return a redirect URL/i
		);
		expect(oauthStarts).toBe(1);
		expect(oauthProvider).toBe('microsoft');
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
				'GET /api/v1/me/calendar': calendarGetHandler({}),
				'GET /api/v1/me/calendar/oauth/start': async () => {
					oauthStarts += 1;
					// Empty URL surfaces a readable error without navigating the browser.
					return { body: { data: { url: '', state: 'test' } } };
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Calendar' }).click();
		await expect.element(page.getByTestId('personal-calendar-section')).toBeInTheDocument();
		await expect.element(page.getByTestId('calendar-xor-banner')).toHaveTextContent(/XOR/i);
		await expect.element(page.getByTestId('calendar-connection-label')).toHaveTextContent(
			/Not connected/i
		);
		await expect.element(page.getByTestId('calendar-connect')).toBeInTheDocument();
		await expect.element(page.getByTestId('profile-caldav-form')).toBeInTheDocument();
		await expect.element(page.getByTestId('caldav-url')).toBeInTheDocument();

		await page.getByTestId('calendar-connect').click();
		await expect.poll(() => oauthStarts).toBe(1);
		await expect.element(page.getByTestId('calendar-connect-error')).toHaveTextContent(
			/did not return a redirect URL/i
		);
	});

	it('renders connected Calendar status from GET /me/calendar', async () => {
		const googleActive = {
			provider: 'google',
			status: 'active',
			credentials_configured: true,
			config: { account_email: 'joe@acme.test', calendar_id: 'primary' },
			account_email: 'joe@acme.test',
			calendar_id: 'primary',
			last_error_code: null,
			last_sync_at: null
		};
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
				'GET /api/v1/me/calendar': calendarGetHandler({
					active: googleActive,
					google: googleActive,
					caldav: disconnectedCalendar('caldav')
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
		await expect.element(page.getByTestId('calendar-xor-banner')).toHaveTextContent(/Google/i);
		await expect.element(page.getByTestId('caldav-xor-note')).toHaveTextContent(/Google is the active sync/i);
	});

	it('saves and tests CalDAV connection from Settings', async () => {
		let putBody: unknown = null;
		let testCalls = 0;
		const caldavActive = {
			provider: 'caldav',
			status: 'active',
			credentials_configured: true,
			config: {
				caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
				username: 'user@mail.test',
				calendar_id: 'personal'
			},
			account_email: 'user@mail.test',
			calendar_id: 'personal',
			caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
			last_error_code: null,
			last_sync_at: null
		};
		let currentCaldav: Record<string, unknown> = disconnectedCalendar('caldav');
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
				'GET /api/v1/me/calendar': calendarGetHandler({
					get active() {
						return currentCaldav.status === 'active' ? currentCaldav : disconnectedCalendar('google');
					},
					google: disconnectedCalendar('google'),
					get caldav() {
						return currentCaldav;
					}
				}),
				'PUT /api/v1/me/calendar': async (request) => {
					putBody = await request.json();
					currentCaldav = caldavActive;
					return { body: { data: caldavActive } };
				},
				'POST /api/v1/me/calendar/test': async () => {
					testCalls += 1;
					return {
						body: {
							data: {
								ok: true,
								error_code: null,
								message: 'CalDAV PROPFIND succeeded.'
							}
						}
					};
				}
			}),
			getOrgId: () => session.selectedOrgId
		});

		render(PersonalSettingsController, { api, session });

		await page.getByRole('tab', { name: 'Calendar' }).click();
		await page
			.getByTestId('caldav-url')
			.fill('https://caldav.example.test/SOGo/dav/user/Calendar/');
		await page.getByTestId('caldav-username').fill('user@mail.test');
		await page.getByTestId('caldav-password').fill('app-password');
		await page.getByTestId('caldav-submit').click();

		await expect.poll(() => putBody).toEqual({
			provider: 'caldav',
			caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
			username: 'user@mail.test',
			password: 'app-password',
			calendar_id: null
		});
		await expect.element(page.getByTestId('caldav-connection-label')).toHaveTextContent(
			/user@mail.test/i
		);
		await expect.element(page.getByTestId('caldav-credentials-saved')).toBeInTheDocument();

		await page.getByTestId('caldav-test').click();
		await expect.poll(() => testCalls).toBe(1);
		await expect.element(page.getByTestId('caldav-test-feedback')).toHaveTextContent(
			/PROPFIND succeeded/i
		);
	});
});
