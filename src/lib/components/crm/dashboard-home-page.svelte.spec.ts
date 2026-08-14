import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import DashboardHomePage from './dashboard-home-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORG_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const MEMBERSHIP_B = 'cccccccc-cccc-4ddd-8eee-111111111111';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const TASK_B = '22222222-3333-4444-8555-666666666666';
const MEETING_ID = '33333333-4444-4555-8666-777777777777';

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
		location: 'Boardroom',
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
		...overrides
	};
}

function sampleDashboardSummary(overrides: Record<string, unknown> = {}) {
	return {
		currency: 'GBP',
		as_of: '2026-08-14',
		kpis: {
			outstanding_cents: 7500,
			overdue_cents: 7500,
			open_invoice_count: 1,
			overdue_invoice_count: 1,
			cash_collected_30d_cents: 2500,
			cash_collected_prior_30d_cents: 0,
			booked_30d_cents: 10000,
			booked_prior_30d_cents: 0
		},
		aging: [
			{ bucket: 'current', cents: 0, count: 0 },
			{ bucket: '1_30', cents: 7500, count: 1 },
			{ bucket: '31_60', cents: 0, count: 0 },
			{ bucket: '61_90', cents: 0, count: 0 },
			{ bucket: '90_plus', cents: 0, count: 0 }
		],
		monthly: [
			{ month: '2026-03', cash_cents: 0, booked_cents: 0 },
			{ month: '2026-04', cash_cents: 0, booked_cents: 0 },
			{ month: '2026-05', cash_cents: 0, booked_cents: 0 },
			{ month: '2026-06', cash_cents: 0, booked_cents: 0 },
			{ month: '2026-07', cash_cents: 0, booked_cents: 0 },
			{ month: '2026-08', cash_cents: 2500, booked_cents: 10000 }
		],
		quote_pipeline: [
			{ status: 'draft', count: 0, total_cents: 0 },
			{ status: 'sent', count: 1, total_cents: 50000 },
			{ status: 'accepted', count: 0, total_cents: 0 },
			{ status: 'rejected', count: 0, total_cents: 0 }
		],
		chase: {
			overdue_invoices: [
				{
					id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
					number: 'INV-0001',
					client_name: 'Acme Client',
					amount_cents: 7500,
					days: 15
				}
			],
			due_soon_invoices: [],
			awaiting_quotes: [],
			expiring_quotes: []
		},
		other_currency_doc_count: 0,
		...overrides
	};
}

describe('DashboardHomePage integration', () => {
	it('loads my tasks with assignee=me and toggles done', async () => {
		const seenTaskUrls: string[] = [];
		let patchBody: unknown;
		let patchIfMatch: string | null = null;

		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async (request) => {
				seenTaskUrls.push(request.url);
				return { body: { data: [sampleTask()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/meetings': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
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

	it('loads upcoming meetings with upcoming=true', async () => {
		const seenMeetingUrls: string[] = [];
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async () => ({
				body: { data: [sampleTask()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/meetings': async (request) => {
				seenMeetingUrls.push(request.url);
				return { body: { data: [sampleMeeting()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/timeline-events': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(DashboardHomePage, { api, session });

		await expect.element(page.getByText('Q2 planning')).toBeInTheDocument();
		await expect.poll(() => seenMeetingUrls.length).toBeGreaterThan(0);
		expect(seenMeetingUrls.some((url) => url.includes('upcoming=true'))).toBe(true);
		expect(seenMeetingUrls.some((url) => url.includes('limit=5'))).toBe(true);
	});

	it('loads org timeline into Recent activity with entity deep-links', async () => {
		const seenTimelineUrls: string[] = [];
		const session = sessionForOrg();
		const quoteId = 'aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd';

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async () => ({
				body: { data: [sampleTask()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/meetings': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/timeline-events': async (request) => {
				seenTimelineUrls.push(request.url);
				return {
					body: {
						data: [
							{
								id: 'eeeeeeee-eeee-4fff-8aaa-bbbbbbbbbbbb',
								org_id: ORG_A,
								entity_type: 'quote',
								entity_id: quoteId,
								kind: 'status',
								title: 'Quote accepted',
								body: null,
								actor_type: 'system',
								actor_id: null,
								source_type: 'quote',
								source_id: quoteId,
								payload: {},
								occurred_at: '2026-08-05T12:00:00.000Z',
								created_at: '2026-08-05T12:00:00.000Z'
							}
						],
						meta: { next_cursor: null }
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(DashboardHomePage, { api, session });

		const link = page.getByRole('link', { name: 'Quote accepted' });
		await expect.element(link).toBeInTheDocument();
		expect(link.element().getAttribute('href')).toBe(`/quotes/${quoteId}`);
		await expect.poll(() => seenTimelineUrls.length).toBeGreaterThan(0);
		expect(seenTimelineUrls.some((url) => url.includes('limit=50'))).toBe(true);
	});

	it('opens create drawer from New task and prepends My tasks on success', async () => {
		let createBody: unknown;
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async () => ({
				body: { data: [sampleTask()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/meetings': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'POST /api/v1/tasks': async (request) => {
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleTask({
							id: TASK_B,
							title: 'Chase invoice',
							status: 'in_progress',
							assignee_membership_id: MEMBERSHIP_ID
						})
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

		const newTask = page.getByRole('button', { name: 'New task' });
		await expect.element(newTask).toBeInTheDocument();
		expect(newTask.element().getAttribute('href')).toBeNull();

		await newTask.click();
		await expect.element(page.getByText('Create a follow-up for your team.')).toBeInTheDocument();
		await page.getByLabelText('Title').fill('Chase invoice');
		await page.getByTestId('task-form').getByRole('button', { name: 'Save task' }).click();

		await expect
			.element(page.getByRole('button', { name: 'Chase invoice', exact: true }))
			.toBeInTheDocument();
		await expect.element(page.getByText('Home')).toBeInTheDocument();
		expect(createBody).toMatchObject({
			title: 'Chase invoice',
			priority: 'p3',
			status: 'open',
			source: 'manual'
		});
	});

	it('discards a delayed org timeline that completes after org switch', async () => {
		let releaseTimeline: (() => void) | undefined;
		const timelineGate = new Promise<void>((resolve) => {
			releaseTimeline = resolve;
		});
		let timelineStarted = false;
		let timelineCompletions = 0;
		const staleTitle = 'Stale org A quote accepted';

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
					membership_id: MEMBERSHIP_ID,
					theme_default: 'system'
				},
				{
					org_id: ORG_B,
					org_name: 'Certivue',
					org_slug: 'certivue',
					logo_url: null,
					role: 'owner',
					membership_id: MEMBERSHIP_B,
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({
				body: {
					data: [
						...organisationsListBody().data,
						{
							membership: {
								id: MEMBERSHIP_B,
								role: 'owner',
								status: 'active',
								joined_at: '2026-01-01T00:00:00Z'
							},
							organisation: {
								id: ORG_B,
								name: 'Certivue',
								slug: 'certivue',
								logo_path: null,
								default_currency: 'USD',
								timezone: 'UTC',
								locale: 'en-GB',
								country_code: 'GB',
								theme_default: 'system'
							}
						}
					]
				}
			}),
			'GET /api/v1/tasks': async () => ({
				body: { data: [sampleTask()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/meetings': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/timeline-events': async (request) => {
				const orgId = request.headers.get('x-org-id');
				if (orgId === ORG_A) {
					timelineStarted = true;
					await timelineGate;
					timelineCompletions += 1;
					return {
						body: {
							data: [
								{
									id: 'eeeeeeee-eeee-4fff-8aaa-bbbbbbbbbbbb',
									org_id: ORG_A,
									entity_type: 'quote',
									entity_id: 'aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd',
									kind: 'status',
									title: staleTitle,
									body: null,
									actor_type: 'system',
									actor_id: null,
									source_type: 'quote',
									source_id: 'aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd',
									payload: {},
									occurred_at: '2026-08-05T12:00:00.000Z',
									created_at: '2026-08-05T12:00:00.000Z'
								}
							],
							meta: { next_cursor: null }
						}
					};
				}
				return { body: { data: [], meta: { next_cursor: null } } };
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(DashboardHomePage, { api, session });

		await vi.waitFor(() => expect(timelineStarted).toBe(true));
		session.selectOrg(ORG_B);
		await vi.waitFor(() => expect(session.selectedOrgId).toBe(ORG_B));

		releaseTimeline?.();
		await vi.waitFor(() => expect(timelineCompletions).toBe(1));
		await expect.element(page.getByText(staleTitle)).not.toBeInTheDocument();
	});

	it('loads money summary into KPIs and chase list', async () => {
		const seenSummaryUrls: string[] = [];
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({ body: orgMembersListBody() }),
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/tasks': async () => ({
				body: { data: [sampleTask()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/dashboard/summary': async (request) => {
				seenSummaryUrls.push(request.url);
				return { body: { data: sampleDashboardSummary() } };
			},
			'GET /api/v1/meetings': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/timeline-events': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(DashboardHomePage, { api, session });

		await expect.element(page.getByText('Outstanding AR')).toBeInTheDocument();
		await expect.element(page.getByText('AR aging')).toBeInTheDocument();
		await expect.element(page.getByText('INV-0001 overdue')).toBeInTheDocument();
		await expect.poll(() => seenSummaryUrls.length).toBeGreaterThan(0);
		expect(seenSummaryUrls.some((url) => url.includes('/api/v1/dashboard/summary'))).toBe(true);
	});
});
