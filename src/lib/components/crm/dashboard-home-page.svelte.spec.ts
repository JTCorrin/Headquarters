import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import DashboardHomePage from './dashboard-home-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const TASK_ID = '11111111-2222-4333-8444-555555555555';

function sampleTask(overrides: Record<string, unknown> = {}) {
	return {
		id: TASK_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		title: 'Send kickoff pack',
		description: 'Email the onboarding deck',
		priority: 'p3',
		status: 'open',
		assignee_membership_id: MEMBERSHIP_ID,
		assignee_agent_id: null,
		due_at: '2026-12-18T00:00:00.000Z',
		started_at: null,
		completed_at: null,
		blocked_reason: null,
		source: 'manual',
		entity_type: null,
		entity_id: null,
		meeting_id: null,
		project_card_id: null,
		position: 0,
		metadata: {},
		...overrides
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

function sessionForOrg() {
	return createOrgSession({
		storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
		initialOrgId: ORG_A,
		initialMemberships: [
			{
				org_id: ORG_A,
				org_name: 'Corrin Data',
				org_slug: 'corrin-data',
				logo_url: null,
				role: 'owner',
				membership_id: MEMBERSHIP_ID,
				theme_default: 'system'
			}
		]
	});
}

function organisationsListBody() {
	return {
		data: [
			{
				membership: {
					id: MEMBERSHIP_ID,
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
					timezone: 'UTC',
					locale: 'en-GB',
					country_code: 'GB',
					theme_default: 'system'
				}
			}
		]
	};
}

describe('DashboardHomePage integration', () => {
	it('loads my tasks with assignee=me and toggles done', async () => {
		const seenTaskUrls: string[] = [];
		let patchBody: unknown;
		let patchIfMatch: string | null = null;

		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async (request) => {
				seenTaskUrls.push(request.url);
				return { body: { data: [sampleTask()], meta: { next_cursor: null } } };
			},
			[`PATCH /api/v1/tasks/${TASK_ID}`]: async (request) => {
				patchBody = await request.json();
				patchIfMatch = request.headers.get('if-match');
				return {
					body: {
						data: sampleTask({ status: 'done', version: 2, completed_at: '2026-03-18T12:00:00Z' })
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(DashboardHomePage, { api, session });

		await expect.element(page.getByText('Home')).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Send kickoff pack', exact: true }))
			.toBeInTheDocument();
		expect(seenTaskUrls.some((url) => url.includes('assignee=me'))).toBe(true);

		await page.getByRole('button', { name: 'Complete Send kickoff pack' }).click();
		await expect.poll(() => patchBody).toEqual({ status: 'done' });
		expect(patchIfMatch).toBe('"1"');
		await expect
			.element(page.getByRole('button', { name: 'Reopen Send kickoff pack' }))
			.toBeInTheDocument();
	});
});
