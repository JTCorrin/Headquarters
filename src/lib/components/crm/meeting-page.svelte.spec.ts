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
const DOCUMENT_ID = 'dddddddd-dddd-4eee-8fff-000000000000';
const PROPOSAL_ID = 'pppppppp-pppp-4qqq-8rrr-ssssssssssss';
const PROPOSAL_ID_2 = 'qqqqqqqq-qqqq-4rrr-8sss-tttttttttttt';

function sampleTranscript() {
	return {
		id: 'tttttttt-tttt-4uuu-8vvv-wwwwwwwwwwww',
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		meeting_id: MEETING_ID,
		document_id: DOCUMENT_ID,
		provider: null,
		language_code: null,
		status: 'ready' as const,
		plain_text: 'Joe: Ship the kickoff pack.',
		segments: null,
		processed_at: '2026-01-01T00:01:00Z',
		error_code: null
	};
}

function sampleProposal(id: string, title: string, status: 'proposed' | 'accepted' | 'dismissed' = 'proposed') {
	return {
		id,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		meeting_id: MEETING_ID,
		title,
		description: null,
		suggested_assignee_membership_id: null,
		suggested_due_at: null,
		confidence: 0.9,
		status,
		accepted_task_id: status === 'accepted' ? 'task-1' : null,
		decided_by: null,
		decided_at: status === 'proposed' ? null : '2026-01-01T00:02:00Z'
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
		transcript: null,
		task_proposals: [],
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
	it('loads nested attendees and wires AI chrome handlers', async () => {
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
		await expect.element(page.getByText(/Upload a \.vtt transcript file/i)).toBeInTheDocument();

		const upload = page.getByRole('button', { name: 'Upload transcript' });
		await expect.element(upload).not.toBeDisabled();
		const generate = page.getByRole('button', { name: 'Generate summary' });
		await expect.element(generate).toBeDisabled();
		await expect.element(page.getByTestId('meeting-transcript-file')).toBeInTheDocument();
	});

	it('generates summary and accepts or dismisses proposals', async () => {
		const session = sessionForOrg();
		let meetingState = sampleMeeting({
			version: 2,
			transcript_status: 'ready',
			transcript: sampleTranscript()
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/meetings/${MEETING_ID}`]: async () => ({
				body: { data: meetingState }
			}),
			[`POST /api/v1/meetings/${MEETING_ID}/generate-summary`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"2"');
				expect(request.headers.get('content-type')).toMatch(/application\/json/i);
				await expect(request.json()).resolves.toEqual({});
				meetingState = sampleMeeting({
					version: 3,
					transcript_status: 'ready',
					summary_status: 'ready',
					summary: 'Follow up on the kickoff pack.',
					transcript: sampleTranscript(),
					task_proposals: [
						sampleProposal(PROPOSAL_ID, 'Send kickoff pack'),
						sampleProposal(PROPOSAL_ID_2, 'Book Thursday kickoff')
					]
				});
				return { body: { data: meetingState } };
			},
			[`POST /api/v1/meetings/${MEETING_ID}/task-proposals/${PROPOSAL_ID}/accept`]: async (
				request
			) => {
				expect(request.headers.get('if-match')).toBe('"3"');
				const proposals = (meetingState.task_proposals as Array<Record<string, unknown>>).map(
					(proposal) =>
						proposal.id === PROPOSAL_ID
							? {
									...proposal,
									status: 'accepted',
									accepted_task_id: 'task-1',
									decided_at: '2026-01-01T00:02:00Z'
								}
							: proposal
				);
				meetingState = { ...meetingState, version: 4, task_proposals: proposals };
				return { body: { data: meetingState } };
			},
			[`POST /api/v1/meetings/${MEETING_ID}/task-proposals/${PROPOSAL_ID_2}/dismiss`]: async (
				request
			) => {
				expect(request.headers.get('if-match')).toBe('"4"');
				const proposals = (meetingState.task_proposals as Array<Record<string, unknown>>).map(
					(proposal) =>
						proposal.id === PROPOSAL_ID_2
							? {
									...proposal,
									status: 'dismissed',
									decided_at: '2026-01-01T00:03:00Z'
								}
							: proposal
				);
				meetingState = { ...meetingState, version: 5, task_proposals: proposals };
				return { body: { data: meetingState } };
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingPage, { api, session, meetingId: MEETING_ID });

		await expect.element(page.getByText('Joe: Ship the kickoff pack.')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Generate summary' }).click();
		await expect
			.element(page.getByText('Follow up on the kickoff pack.'))
			.toBeInTheDocument();
		await expect.element(page.getByText('Send kickoff pack')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
		await expect.element(page.getByText('Accepted')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
		await expect.element(page.getByText('Dismissed')).toBeInTheDocument();
	});

	it('surfaces generate-summary failures without inventing success', async () => {
		const session = sessionForOrg();
		const meetingState = sampleMeeting({
			version: 2,
			transcript_status: 'ready',
			transcript: sampleTranscript()
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/meetings/${MEETING_ID}`]: async () => ({
				body: { data: meetingState }
			}),
			[`POST /api/v1/meetings/${MEETING_ID}/generate-summary`]: async () => ({
				status: 422,
				body: {
					error: {
						code: 'BAD_REQUEST',
						message: 'Transcript is not ready for summary generation.'
					}
				}
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(MeetingPage, { api, session, meetingId: MEETING_ID });

		await expect.element(page.getByText('Joe: Ship the kickoff pack.')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Generate summary' }).click();
		await expect
			.element(page.getByTestId('meeting-ai-error'))
			.toHaveTextContent(/Transcript is not ready/i);
	});
});
