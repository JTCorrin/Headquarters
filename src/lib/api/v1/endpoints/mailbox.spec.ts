import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

describe('mailbox endpoints', () => {
	it('starts OAuth with provider query and completes callback without echoing secrets', async () => {
		let startUrl = '';
		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/me/mailbox/oauth/start': async (request) => {
					startUrl = request.url;
					return {
						body: {
							data: {
								url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=abc',
								state: 'abc',
								provider: 'microsoft'
							}
						}
					};
				},
				'POST /api/v1/me/mailbox/oauth/callback': async (request) => {
					const body = await request.json();
					expect(body).toEqual({ code: 'auth-code', state: 'abc' });
					return {
						body: {
							data: {
								id: 'mb-1',
								email_address: 'joe@outlook.test',
								username: 'joe@outlook.test',
								from_name: null,
								imap_host: 'outlook.office365.com',
								imap_port: 993,
								imap_security: 'tls',
								smtp_host: 'smtp-mail.outlook.com',
								smtp_port: 587,
								smtp_security: 'starttls',
								credentials_configured: true,
								status: 'configured',
								auth_mode: 'oauth',
								oauth_provider: 'microsoft',
								last_checked_at: null,
								last_error_code: null
							}
						}
					};
				}
			}),
			getOrgId: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
		});

		const start = await api.mailbox.startOAuth('microsoft');
		expect(new URL(startUrl).searchParams.get('provider')).toBe('microsoft');
		expect(start.provider).toBe('microsoft');
		expect(start.url).toContain('login.microsoftonline.com');
		expect(JSON.stringify(start)).not.toMatch(/client_secret|refresh_token|access_token/i);

		const account = await api.mailbox.completeOAuth({ code: 'auth-code', state: 'abc' });
		expect(account.auth_mode).toBe('oauth');
		expect(account.oauth_provider).toBe('microsoft');
		expect(account.email_address).toBe('joe@outlook.test');
		expect(JSON.stringify(account)).not.toMatch(/secret_ref|token_blob|refresh_token|access_token/i);
	});
});
