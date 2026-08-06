import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import MeetingsPage from './meetings-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const MEETING_ID = '11111111-2222-4333-8444-555555555555';
const MEETING_B = '22222222-3333-4444-8555-666666666666';

function sampleMeeting(overrides: Record<string, unknown> = {}) {
	return {
		id: MEETING_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		title: 'Q2 planning',
		status: 'scheduled',
		starts_at: '2026-08-10T14:00:00.000Z',
		ends_at: '2026-08-10T14:45:00.000Z',
		timezone: 'UTC',
		location: null,
		meeting_url: null,
		organiser_membership_id: MEMBERSHIP_ID,
		related_entity_type: null,
		related_entity_id: null,
		calendar_provider: null,
		external_event_id: null,
		transcript_status: 'none',
		summary_status: 'none',
		summary: null,
		metadata: {},
		attendees: [
			{
				id: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb',
				org_id: ORG_A,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				created_by: null,
				updated_by: null,
				deleted_at: null,
				version: 1,
				meeting_id: MEETING_ID,
				contact_id: null,
				membership_id: null,
				name: 'Ava Chen',
				email: 'ava@northwind.com',
				response_status: 'needs_action',
				attended: null,
				organiser: true
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

describe('MeetingsPage integration', () => {
	it('lists meetings with X-Org-Id and creates with structured attendees', async () => {
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;

		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: organisationsListBody() };
			},
			'GET /api/v1/meetings': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleMeeting()], meta: { next_cursor: null } } };
			},
			'POST /api/v1/meetings': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleMeeting({
							id: MEETING_B,
							title: 'Renewal check-in',
							attendees: [
								{
									id: 'cccccccc-1111-4222-8333-dddddddddddd',
									org_id: ORG_A,
									created_at: '2026-01-01T00:00:00Z',
									updated_at: '2026-01-01T00:00:00Z',
									created_by: null,
									updated_by: null,
									deleted_at: null,
									version: 1,
									meeting_id: MEETING_B,
									contact_id: null,
									membership_id: null,
									name: 'Sam Ortiz',
									email: 'sam@contoso.com',
									response_status: 'needs_action',
									attended: null,
									organiser: false
								}
							]
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingsPage, { api, session });

		await expect.element(page.getByRole('link', { name: 'Q2 planning' })).toBeInTheDocument();
		expect(seenOrgHeaders.some((h) => h === ORG_A)).toBe(true);

		await page.getByRole('button', { name: 'New meeting' }).click();
		await page.getByLabelText('Title').fill('Renewal check-in');
		await page.getByTestId('meeting-start-date').fill('2026-08-12');
		await page.getByTestId('meeting-start-time').fill('11:00');
		await page.getByTestId('meeting-end-date').fill('2026-08-12');
		await page.getByTestId('meeting-end-time').fill('11:30');
		await page.getByRole('button', { name: 'Add' }).click();
		await page.getByLabelText('Email').fill('sam@contoso.com');
		await page.getByLabelText('Name').fill('Sam Ortiz');
		await page.getByTestId('meeting-form').getByRole('button', { name: 'Save meeting' }).click();

		await expect
			.element(page.getByRole('link', { name: 'Renewal check-in' }))
			.toBeInTheDocument();
		expect(createBody).toMatchObject({
			title: 'Renewal check-in',
			status: 'scheduled',
			attendees: [{ email: 'sam@contoso.com', name: 'Sam Ortiz' }]
		});
	});

	it('passes entity_type and entity_id to listMeetings when filtered', async () => {
		const entityQueries: string[] = [];
		const ENTITY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/meetings': async (request) => {
				const url = new URL(request.url);
				entityQueries.push(
					`${url.searchParams.get('entity_type') ?? ''}|${url.searchParams.get('entity_id') ?? ''}`
				);
				return {
					body: {
						data: [
							sampleMeeting({
								related_entity_type: 'project',
								related_entity_id: ENTITY_ID
							})
						],
						meta: { next_cursor: null }
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingsPage, {
			api,
			session,
			entityFilter: { entity_type: 'project', entity_id: ENTITY_ID },
			onClearEntityFilter: () => {}
		});

		await expect.element(page.getByRole('link', { name: 'Q2 planning' })).toBeInTheDocument();
		await expect.element(page.getByTestId('list-filter-banner')).toBeInTheDocument();
		expect(entityQueries).toContain(`project|${ENTITY_ID}`);
	});

	it('edits a meeting with If-Match and related project', async () => {
		const PROJECT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
		let patchBody: unknown;
		let ifMatch: string | null = null;
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/meetings': async () => ({
				body: { data: [sampleMeeting()], meta: { next_cursor: null } }
			}),
			[`GET /api/v1/meetings/${MEETING_ID}`]: async () => ({
				body: { data: sampleMeeting() }
			}),
			'GET /api/v1/projects': async () => ({
				body: {
					data: [
						{
							id: PROJECT_ID,
							org_id: ORG_A,
							created_at: '2026-01-01T00:00:00Z',
							updated_at: '2026-01-01T00:00:00Z',
							created_by: null,
							updated_by: null,
							deleted_at: null,
							version: 1,
							client_id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
							name: 'Northwind rollout',
							description: null,
							status: 'active',
							owner_membership_id: null,
							position: 0,
							starts_on: null,
							due_on: null,
							completed_at: null,
							columns: []
						}
					],
					meta: { next_cursor: null }
				}
			}),
			[`PATCH /api/v1/meetings/${MEETING_ID}`]: async (request) => {
				ifMatch = request.headers.get('if-match');
				patchBody = await request.json();
				return {
					body: {
						data: sampleMeeting({
							version: 2,
							title: 'Q2 planning (updated)',
							related_entity_type: 'project',
							related_entity_id: PROJECT_ID
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingsPage, { api, session });

		await expect.element(page.getByRole('link', { name: 'Q2 planning' })).toBeInTheDocument();
		await page.getByRole('button', { name: 'Open meeting actions' }).click();
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		const editForm = page.getByTestId('meeting-form');
		await editForm.getByLabelText('Title').fill('Q2 planning (updated)');
		await editForm.getByLabelText('Related to').click();
		await page.getByRole('option', { name: 'Project' }).click();
		await expect.element(page.getByTestId('meeting-related-picker')).toBeInTheDocument();
		await page.getByTestId('meeting-related-picker').click();
		await page.getByText('Northwind rollout').click();
		await editForm.getByRole('button', { name: 'Save changes' }).click();

		await expect
			.element(page.getByRole('link', { name: 'Q2 planning (updated)' }))
			.toBeInTheDocument();
		expect(ifMatch).toBe('"1"');
		expect(patchBody).toMatchObject({
			title: 'Q2 planning (updated)',
			related_entity_type: 'project',
			related_entity_id: PROJECT_ID
		});
	});
});
