import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import ProjectPage from './project-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const CARD_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const COL_BACKLOG = 'bbbbbbbb-1111-4222-8333-cccccccccccc';
const COL_DOING = 'cccccccc-1111-4222-8333-dddddddddddd';

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
		description: 'Delivery board',
		status: 'active',
		owner_membership_id: null,
		starts_on: null,
		due_on: null,
		completed_at: null,
		position: 0,
		client_label: 'Northwind',
		columns: [
			{
				id: COL_BACKLOG,
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
				cards: [
					{
						id: CARD_ID,
						org_id: ORG_A,
						created_at: '2026-01-01T00:00:00Z',
						updated_at: '2026-01-01T00:00:00Z',
						created_by: null,
						updated_by: null,
						deleted_at: null,
						version: 1,
						project_id: PROJECT_ID,
						column_id: COL_BACKLOG,
						title: 'Draft kickoff agenda',
						description: null,
						assignee_membership_id: null,
						task_id: null,
						due_at: null,
						position: 0,
						completed_at: null
					}
				]
			},
			{
				id: COL_DOING,
				org_id: ORG_A,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				created_by: null,
				updated_by: null,
				deleted_at: null,
				version: 1,
				project_id: PROJECT_ID,
				name: 'Doing',
				key: 'doing',
				position: 1,
				wip_limit: null,
				cards: []
			}
		],
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

describe('ProjectPage integration', () => {
	it('loads nested workspace cards and columns', async () => {
		const session = sessionForOrg();
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/projects/${PROJECT_ID}`]: async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				return { body: { data: sampleProject() } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(ProjectPage, { api, session, projectId: PROJECT_ID });

		await expect.element(page.getByText('Q2 retainer delivery')).toBeInTheDocument();
		await expect.element(page.getByText('Draft kickoff agenda')).toBeInTheDocument();
		await expect.element(page.getByText('Northwind', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Add card' })).toBeInTheDocument();
	});

	it('shows Internal without a client link for unattached projects', async () => {
		const session = sessionForOrg();
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/projects/${PROJECT_ID}`]: async () => ({
				body: {
					data: sampleProject({
						client_id: null,
						client_label: 'Internal',
						name: 'Ops handbook'
					})
				}
			}),
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(ProjectPage, { api, session, projectId: PROJECT_ID });

		await expect.element(page.getByText('Ops handbook')).toBeInTheDocument();
		await expect.element(page.getByText('Internal', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Open client' })).not.toBeInTheDocument();
	});

	it('edits project with archive status and creates a titled card', async () => {
		const session = sessionForOrg();
		let projectPatch: unknown;
		let cardCreate: unknown;
		let projectState = sampleProject();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/projects/${PROJECT_ID}`]: async () => ({ body: { data: projectState } }),
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			[`PATCH /api/v1/projects/${PROJECT_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				projectPatch = await request.json();
				projectState = sampleProject({
					version: 2,
					name: 'Q2 retainer (rev)',
					status: 'active',
					description: 'Updated scope'
				});
				return { body: { data: projectState } };
			},
			[`POST /api/v1/projects/${PROJECT_ID}/cards`]: async (request) => {
				cardCreate = await request.json();
				return {
					status: 201,
					body: {
						data: {
							id: 'dddddddd-1111-4222-8333-eeeeeeeeeeee',
							org_id: ORG_A,
							created_at: '2026-01-01T00:00:00Z',
							updated_at: '2026-01-01T00:00:00Z',
							created_by: null,
							updated_by: null,
							deleted_at: null,
							version: 1,
							project_id: PROJECT_ID,
							column_id: COL_BACKLOG,
							title: 'Ship onboarding pack',
							description: 'Include kickoff notes',
							assignee_membership_id: null,
							task_id: null,
							due_at: null,
							position: 1,
							completed_at: null
						}
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(ProjectPage, { api, session, projectId: PROJECT_ID });

		await expect.element(page.getByText('Q2 retainer delivery')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Edit' }).click();
		const projectForm = page.getByTestId('project-form');
		await projectForm.getByLabelText('Name').fill('Q2 retainer (rev)');
		await projectForm.getByLabelText('Description').fill('Updated scope');
		await projectForm.getByRole('button', { name: 'Save changes' }).click();

		await expect.poll(() => projectPatch).toMatchObject({
			name: 'Q2 retainer (rev)',
			description: 'Updated scope',
			status: 'active',
			client_id: CLIENT_ID
		});
		await expect.element(page.getByText('Q2 retainer (rev)')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Add card' }).click();
		const cardForm = page.getByTestId('project-card-form');
		await cardForm.getByLabelText('Title').fill('Ship onboarding pack');
		await cardForm.getByLabelText('Description').fill('Include kickoff notes');
		await cardForm.getByRole('button', { name: 'Create card' }).click();

		await expect.poll(() => cardCreate).toMatchObject({
			title: 'Ship onboarding pack',
			description: 'Include kickoff notes',
			column_id: COL_BACKLOG
		});
		await expect.element(page.getByText('Ship onboarding pack')).toBeInTheDocument();
	});
});
