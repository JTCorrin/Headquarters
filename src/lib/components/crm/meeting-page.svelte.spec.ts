import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import MeetingPage from './meeting-page.svelte';

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
		starts_at: '2026-08-10T14:00:00.000Z',
		ends_at: '2026-08-10T14:45:00.000Z',
		timezone: 'UTC',
		location: 'Boardroom',
		meeting_url: null,
		organiser_membership_id: MEMBERSHIP_ID,
		related_entity_type: 'client',
		related_entity_id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
		related_entity_label: 'Northwind',
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

describe('MeetingPage integration', () => {
	it('loads nested attendees and keeps AI chrome inert', async () => {
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/meetings/${MEETING_ID}`]: async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				return { body: { data: sampleMeeting() } };
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingPage, { api, session, meetingId: MEETING_ID });

		await expect.element(page.getByText('Q2 planning')).toBeInTheDocument();
		await expect
			.element(page.getByText('Ava Chen · ava@northwind.com'))
			.toBeInTheDocument();
		await expect.element(page.getByText('Northwind', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('Boardroom', { exact: true })).toBeInTheDocument();
		await expect
			.element(page.getByText(/Transcript upload arrives in a later slice/i))
			.toBeInTheDocument();

		const upload = page.getByRole('button', { name: 'Upload transcript' });
		await expect.element(upload).toBeDisabled();
		const generate = page.getByRole('button', { name: 'Generate summary' });
		await expect.element(generate).toBeDisabled();
	});
});
