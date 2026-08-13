import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import ProjectsPage from './projects-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';

function sampleProject(overrides: Record<string, unknown> = {}) {
	return {
		id: PROJECT_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		client_id: CLIENT_ID,
		name: 'Q2 retainer delivery',
		description: null,
		status: 'active',
		owner_membership_id: null,
		starts_on: null,
		due_on: null,
		completed_at: null,
		position: 0,
		client_label: 'Northwind',
		columns: [
			{
				id: 'col-backlog',
				org_id: ORG_A,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				created_by: null,
				updated_by: null,
				deleted_at: null,
				version: 1,
				project_id: PROJECT_ID,
				name: 'Backlog',
				key: 'backlog',
				position: 0,
				wip_limit: null,
				cards: []
			}
		],
		...overrides
	};
}

function sampleClient() {
	return {
		id: CLIENT_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Northwind',
		status: 'active',
		website_url: null,
		industry: null,
		primary_email: null,
		phone: null,
		tax_identifier: null,
		registration_number: null,
		default_currency: 'GBP',
		payment_terms_days: null,
		renewal_on: null,
		notes: null,
		billing_address: null,
		shipping_address: null,
		metadata: {}
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

describe('ProjectsPage integration', () => {
	it('lists projects with X-Org-Id and creates an internal project by default', async () => {
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;

		const session = sessionForOrg();
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/projects': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleProject()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			'POST /api/v1/projects': async (request) => {
				createBody = await request.json();
				return {
					body: {
						data: sampleProject({
							id: '22222222-3333-4444-8555-666666666666',
							name: 'Warehouse rollout',
							status: 'planning',
							client_id: null,
							client_label: 'Internal'
						})
					},
					status: 201
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(ProjectsPage, { api, session });

		await expect.element(page.getByText('Q2 retainer delivery')).toBeInTheDocument();
		expect(seenOrgHeaders.some((h) => h === ORG_A)).toBe(true);

		await page.getByRole('button', { name: 'New project' }).click();
		await page.getByLabelText('Name').fill('Warehouse rollout');
		await page.getByTestId('project-form').getByRole('button', { name: 'Save project' }).click();

		await expect.poll(() => createBody).toMatchObject({
			name: 'Warehouse rollout',
			client_id: null,
			status: 'planning'
		});
	});
});
