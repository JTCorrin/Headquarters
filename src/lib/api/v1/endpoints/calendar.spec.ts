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
				'DELETE /api/v1/me/calendar': async () => ({ status: 204 })
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
});
