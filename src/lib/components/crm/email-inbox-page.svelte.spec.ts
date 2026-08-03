import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import EmailInboxPage from './email-inbox-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MSG_ID = '11111111-2222-4333-8444-555555555555';

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

describe('EmailInboxPage integration', () => {
	it('loads personal inbox via me/email-messages with X-Org-Id', async () => {
		const seenPaths: string[] = [];
		const seenOrgHeaders: string[] = [];

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
					membership_id: 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm',
					theme_default: 'system'
				}
			]
		});

		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/me/mailbox': async () => ({
					body: {
						data: {
							id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
							org_id: ORG_A,
							provider: 'imap',
							email_address: 'fizz@corrindata.com',
							credentials_configured: true,
							smtp_host: 'smtp.example.com',
							smtp_port: 587,
							status: 'active'
						}
					}
				}),
				'GET /api/v1/integrations': async () => ({ body: { data: [] } }),
				'GET /api/v1/me/email-messages': async (request) => {
					seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
					seenPaths.push(new URL(request.url).pathname);
					return {
						body: {
							data: [
								{
									id: MSG_ID,
									org_id: ORG_A,
									mailbox_account_id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
									subject: 'Hello from staging',
									from_address: 'client@example.com',
									from_name: 'Client',
									preview_text: 'Thanks for the quote',
									body_text: 'Thanks for the quote — looks good.',
									received_at: '2026-08-01T12:00:00Z',
									sent_at: null,
									created_at: '2026-08-01T12:00:00Z',
									direction: 'inbound',
									status: 'received',
									is_owner: true
								}
							]
						}
					};
				}
			}),
			getOrgId: () => session.selectedOrgId,
			getAccessToken: () => 'tok'
		});

		render(EmailInboxPage, { api, session });

		await expect.element(page.getByTestId('email-inbox-page')).toBeInTheDocument();
		await expect.element(page.getByTestId('entity-email-inbox')).toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { name: 'Hello from staging' }))
			.toBeInTheDocument();
		expect(seenPaths).toContain('/api/v1/me/email-messages');
		expect(seenOrgHeaders).toContain(ORG_A);
	});
});
