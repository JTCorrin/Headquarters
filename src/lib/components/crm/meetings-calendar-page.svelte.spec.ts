import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import MeetingsCalendarPage from './meetings-calendar-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const MEETING_ID = '11111111-2222-4333-8444-555555555555';

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
		starts_at: '2026-08-10T12:00:00.000Z',
		ends_at: '2026-08-10T12:45:00.000Z',
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
		attendees: [],
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

describe('MeetingsCalendarPage integration', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads the visible month with starts_after/starts_before and opens a meeting', async () => {
		const rangeQueries: Array<{ after: string | null; before: string | null }> = [];
		const onOpenMeeting = vi.fn();
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/meetings': async (request) => {
				const url = new URL(request.url);
				rangeQueries.push({
					after: url.searchParams.get('starts_after'),
					before: url.searchParams.get('starts_before')
				});
				return { body: { data: [sampleMeeting()], meta: { next_cursor: null } } };
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingsCalendarPage, { api, session, onOpenMeeting });

		await expect.element(page.getByTestId('meetings-calendar-grid')).toBeInTheDocument();
		expect(rangeQueries.length).toBeGreaterThan(0);
		expect(rangeQueries[0]?.after).toBeTruthy();
		expect(rangeQueries[0]?.before).toBeTruthy();
		expect(
			new Date(rangeQueries[0]!.before!).getTime()
		).toBeGreaterThan(new Date(rangeQueries[0]!.after!).getTime());

		await expect
			.element(page.getByTestId(`calendar-meeting-${MEETING_ID}`))
			.toBeInTheDocument();
		await page.getByTestId(`calendar-meeting-${MEETING_ID}`).click();
		expect(onOpenMeeting).toHaveBeenCalledWith(MEETING_ID);
	});

	it('prefills Schedule drawer when an empty day is clicked', async () => {
		const session = sessionForOrg();
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/meetings': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingsCalendarPage, { api, session });

		await expect.element(page.getByTestId('meetings-calendar-grid')).toBeInTheDocument();
		await page.getByTestId('calendar-day-2026-08-12').click();

		const form = page.getByTestId('meeting-form');
		await expect.element(form).toBeInTheDocument();
		await expect.element(form.getByLabelText('Starts')).toHaveValue('2026-08-12T09:00');
		await expect.element(form.getByLabelText('Ends')).toHaveValue('2026-08-12T09:30');
	});
});
