import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { apiError, createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import AuditLogPage from './audit-log-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ACTOR = '11111111-2222-4333-8444-555555555555';

function membershipPayload(role: 'owner' | 'admin' | 'member') {
	return {
		data: [
			{
				membership: {
					id: 'm1',
					role,
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

describe('AuditLogPage integration', () => {
	it('lists audit events with X-Org-Id for owners', async () => {
		await page.viewport(1280, 720);
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
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': () => membershipPayload('owner'),
			'GET /api/v1/audit-events': (request) => {
				seenOrgHeaders.push(request.headers.get('X-Org-Id') ?? '');
				expect(new URL(request.url).searchParams.get('limit')).toBe('100');
				return {
					status: 200,
					body: {
						data: [
							{
								id: 'aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd',
								org_id: ORG_A,
								actor_type: 'user',
								actor_id: ACTOR,
								action: 'org.config_updated',
								resource_type: 'organisation',
								resource_id: ORG_A,
								request_id: null,
								ip_address: '192.168.5.10',
								user_agent: null,
								before_data: null,
								after_data: null,
								metadata: { actor_name: 'Joe' },
								created_at: '2026-08-03T12:00:00.000Z'
							}
						]
					}
				};
			}
		});

		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => session.selectedOrgId,
			getAccessToken: async () => 'tok'
		});

		render(AuditLogPage, { api, session });
		await expect.element(page.getByTestId('audit-log-page')).toBeInTheDocument();
		await expect.element(page.getByText('Org Config Updated')).toBeInTheDocument();
		await expect.element(page.getByText('Joe')).toBeInTheDocument();
		expect(seenOrgHeaders).toContain(ORG_A);
		await expect.element(page.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
	});

	it('blocks members before calling the list API', async () => {
		let listed = false;
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					logo_url: null,
					role: 'member',
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/audit-events': () => {
				listed = true;
				return apiError(403, 'FORBIDDEN', 'nope');
			}
		});

		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => session.selectedOrgId,
			getAccessToken: async () => 'tok'
		});

		render(AuditLogPage, { api, session });
		await expect
			.element(page.getByText('Only organisation Owners and Admins can view the audit log.'))
			.toBeInTheDocument();
		expect(listed).toBe(false);
	});

	it('applies date/action/actor filters on reload', async () => {
		const queries: string[] = [];
		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					logo_url: null,
					role: 'admin',
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/audit-events': (request) => {
				queries.push(new URL(request.url).search);
				return { status: 200, body: { data: [] } };
			}
		});

		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => session.selectedOrgId,
			getAccessToken: async () => 'tok'
		});

		render(AuditLogPage, { api, session });
		await expect.element(page.getByTestId('audit-log-filters')).toBeInTheDocument();

		const action = page.getByTestId('audit-filter-action');
		await action.fill('org.config_updated');
		await page.getByTestId('audit-filter-actor').fill(ACTOR);
		await page.getByTestId('audit-filter-apply').click();

		await expect
			.poll(() => queries.some((q) => q.includes('action=org.config_updated')))
			.toBe(true);
		expect(queries.some((q) => q.includes(`actor_id=${ACTOR}`))).toBe(true);
	});
});
