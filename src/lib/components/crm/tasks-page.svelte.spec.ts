import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import TasksPage from './tasks-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const TASK_B = '22222222-3333-4444-8555-666666666666';

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
		due_at: '2026-03-18T00:00:00.000Z',
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

function orgMembersListBody() {
	return {
		data: [
			{
				membership_id: MEMBERSHIP_ID,
				user_id: '99999999-9999-4999-8999-999999999999',
				display_name: 'Joe Thomas',
				role: 'owner',
				job_title: null
			}
		]
	};
}

describe('TasksPage integration', () => {
	it('lists tasks with X-Org-Id and creates a task', async () => {
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;

		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: organisationsListBody() };
			},
			'GET /api/v1/tasks': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleTask()], meta: { next_cursor: null } } };
			},
			'POST /api/v1/tasks': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleTask({
							id: TASK_B,
							title: 'Chase invoice',
							status: 'in_progress'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(TasksPage, { api, session });

		await expect
			.element(page.getByRole('button', { name: 'Send kickoff pack', exact: true }))
			.toBeInTheDocument();
		expect(seenOrgHeaders.some((h) => h === ORG_A)).toBe(true);

		await page.getByRole('button', { name: 'New task' }).click();
		await page.getByLabelText('Title').fill('Chase invoice');
		await page.getByTestId('task-form').getByRole('button', { name: 'Save task' }).click();

		await expect
			.element(page.getByRole('button', { name: 'Chase invoice', exact: true }))
			.toBeInTheDocument();
		expect(createBody).toMatchObject({
			title: 'Chase invoice',
			priority: 'p3',
			status: 'open',
			source: 'manual'
		});
	});

	it('surfaces ETag conflict on edit', async () => {
		const session = sessionForOrg();
		let patchCount = 0;
		let lastPatch: { body: unknown; ifMatch: string | null } | null = null;

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async () => ({
				body: { data: [sampleTask({ version: 2 })], meta: { next_cursor: null } }
			}),
			[`PATCH /api/v1/tasks/${TASK_ID}`]: async (request) => {
				patchCount += 1;
				lastPatch = {
					body: await request.json(),
					ifMatch: request.headers.get('if-match')
				};
				return {
					status: 412,
					body: {
						error: {
							code: 'PRECONDITION_FAILED',
							message: 'Task version does not match If-Match'
						}
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(TasksPage, { api, session });

		await expect
			.element(page.getByRole('button', { name: 'Send kickoff pack', exact: true }))
			.toBeInTheDocument();
		await page.getByRole('button', { name: 'Send kickoff pack', exact: true }).click();
		await expect.element(page.getByText('Edit task')).toBeInTheDocument();
		await page.getByLabelText('Title').last().fill('Updated kickoff pack');
		await page.getByRole('button', { name: 'Save changes' }).click();

		await expect.poll(() => lastPatch?.ifMatch).toBe('"2"');
		await expect
			.element(page.getByText(/412|version does not match|changed elsewhere/i))
			.toBeInTheDocument();
	});

	it('deletes a task from the edit drawer', async () => {
		const session = sessionForOrg();
		let deleted: { id: string; ifMatch: string | null } | null = null;

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async () => ({
				body: { data: [sampleTask({ version: 3 })], meta: { next_cursor: null } }
			}),
			[`DELETE /api/v1/tasks/${TASK_ID}`]: async (request) => {
				deleted = { id: TASK_ID, ifMatch: request.headers.get('if-match') };
				return { status: 204 };
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(TasksPage, { api, session });

		await expect
			.element(page.getByRole('button', { name: 'Send kickoff pack', exact: true }))
			.toBeInTheDocument();
		await page.getByRole('button', { name: 'Send kickoff pack', exact: true }).click();
		await expect.element(page.getByText('Edit task')).toBeInTheDocument();

		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		await page.getByTestId('task-delete').click();
		confirmSpy.mockRestore();

		await expect.poll(() => deleted?.ifMatch).toBe('"3"');
		await expect
			.element(page.getByRole('button', { name: 'Send kickoff pack', exact: true }))
			.not.toBeInTheDocument();
	});

	it('passes entity_type and entity_id to listTasks when filtered', async () => {
		const entityQueries: string[] = [];
		const ENTITY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async (request) => {
				const url = new URL(request.url);
				entityQueries.push(
					`${url.searchParams.get('entity_type') ?? ''}|${url.searchParams.get('entity_id') ?? ''}`
				);
				return {
					body: {
						data: [sampleTask({ entity_type: 'client', entity_id: ENTITY_ID })],
						meta: { next_cursor: null }
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(TasksPage, {
			api,
			session,
			entityFilter: { entity_type: 'client', entity_id: ENTITY_ID },
			onClearEntityFilter: () => {}
		});

		await expect
			.element(page.getByRole('button', { name: 'Send kickoff pack', exact: true }))
			.toBeInTheDocument();
		await expect.element(page.getByTestId('list-filter-banner')).toBeInTheDocument();
		expect(entityQueries).toContain(`client|${ENTITY_ID}`);
	});
});
