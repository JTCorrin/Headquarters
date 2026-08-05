import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

describe('calendar endpoints', () => {
	it('loads status-only connection and starts OAuth without echoing secrets', async () => {
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/me/calendar': async () => ({
					body: {
						data: {
							provider: 'google',
							status: 'active',
							credentials_configured: true,
							config: { account_email: 'joe@acme.test', calendar_id: 'primary' },
							account_email: 'joe@acme.test',
							calendar_id: 'primary',
							last_error_code: null,
							last_sync_at: '2026-08-04T12:00:00Z'
						}
					}
				}),
				'GET /api/v1/me/calendar/oauth/start': async () => ({
					body: {
						data: {
							url: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
							state: 'abc'
						}
					}
				}),
				'DELETE /api/v1/me/calendar': async (request) => {
					expect(new URL(request.url).searchParams.get('provider')).toBe('google');
					return { status: 204 };
				}
			}),
			getOrgId: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
		});

		const connection = await api.calendar.get();
		expect(connection.provider).toBe('google');
		expect(connection.status).toBe('active');
		expect(connection.credentials_configured).toBe(true);
		expect(connection.account_email).toBe('joe@acme.test');
		expect(JSON.stringify(connection)).not.toMatch(/secret_ref|refresh_token|access_token/i);

		const start = await api.calendar.startOAuth();
		expect(start.url).toContain('accounts.google.com');
		expect(start.state).toBe('abc');

		await expect(api.calendar.disconnect()).resolves.toBeUndefined();
	});

	it('normalizes null GET payload to disconnected (matches Cal-Sync-BE)', async () => {
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/me/calendar': async () => ({ body: { data: null } })
			}),
			getOrgId: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
		});

		const connection = await api.calendar.get();
		expect(connection.status).toBe('disconnected');
		expect(connection.credentials_configured).toBe(false);
		expect(connection.provider).toBe('google');
	});

	it('puts CalDAV credentials, tests, and disconnects with provider query', async () => {
		let putBody: unknown = null;
		const api = createApiV1Client({
			fetch: createMockFetch({
				'PUT /api/v1/me/calendar': async (request) => {
					putBody = await request.json();
					return {
						body: {
							data: {
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
							}
						}
					};
				},
				'POST /api/v1/me/calendar/test': async () => ({
					body: {
						data: {
							ok: true,
							error_code: null,
							message: 'CalDAV PROPFIND succeeded.'
						}
					}
				}),
				'DELETE /api/v1/me/calendar': async (request) => {
					expect(new URL(request.url).searchParams.get('provider')).toBe('caldav');
					return { status: 204 };
				},
				'GET /api/v1/me/calendar': async (request) => {
					expect(new URL(request.url).searchParams.get('provider')).toBe('caldav');
					return {
						body: {
							data: {
								provider: 'caldav',
								status: 'active',
								credentials_configured: true,
								config: {
									caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
									username: 'user@mail.test'
								},
								account_email: 'user@mail.test',
								caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
								calendar_id: 'default'
							}
						}
					};
				}
			}),
			getOrgId: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
		});

		const saved = await api.calendar.put({
			provider: 'caldav',
			caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
			username: 'user@mail.test',
			password: 'app-password'
		});
		expect(putBody).toEqual({
			provider: 'caldav',
			caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
			username: 'user@mail.test',
			password: 'app-password'
		});
		expect(saved.provider).toBe('caldav');
		expect(JSON.stringify(saved)).not.toMatch(/password|secret_ref|token_blob/i);

		const test = await api.calendar.test();
		expect(test.ok).toBe(true);

		const loaded = await api.calendar.get(undefined, { provider: 'caldav' });
		expect(loaded.provider).toBe('caldav');
		expect(loaded.caldav_url).toContain('caldav.example.test');

		await expect(api.calendar.disconnect({ provider: 'caldav' })).resolves.toBeUndefined();
	});
});
