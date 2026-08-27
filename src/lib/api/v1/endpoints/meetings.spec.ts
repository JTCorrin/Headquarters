import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEETING_ID = '66666666-3333-4444-8555-666666666666';
const PROPOSAL_ID = '66666666-4444-4555-8555-666666666666';

function meetingFixture() {
	return {
		id: MEETING_ID,
		version: 5,
		title: 'Kickoff',
		status: 'scheduled',
		starts_at: '2026-08-25T10:00:00Z'
	};
}

describe('meetings endpoints', () => {
	it('list passes entity filters', async () => {
		let seenQuery = '';
		const fetchMock = createMockFetch({
			'GET /api/v1/meetings': async (request) => {
				seenQuery = new URL(request.url).search;
				return {
					body: {
						data: [meetingFixture()],
						meta: { next_cursor: null }
					}
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.meetings.list({
			entity_type: 'client',
			entity_id: 'c1',
			upcoming: true
		});
		expect(seenQuery).toContain('entity_type=client');
		expect(seenQuery).toContain('entity_id=c1');
		expect(seenQuery).toContain('upcoming=true');
		expect(listed.data[0]?.id).toBe(MEETING_ID);
	});

	it('update sends If-Match from version', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/meetings/${MEETING_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { body: { data: meetingFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.meetings.update(MEETING_ID, { title: 'New title' } as never, 5);
		expect(capturedIfMatch).toBe('"5"');
	});

	it('attachTranscript posts to the transcript subresource with If-Match', async () => {
		let capturedPath = '';
		let capturedBody: unknown;
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/meetings/${MEETING_ID}/transcript`]: async (request) => {
				capturedPath = new URL(request.url).pathname;
				capturedBody = await request.json();
				capturedIfMatch = request.headers.get('If-Match');
				return { body: { data: meetingFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const updated = await api.meetings.attachTranscript(
			MEETING_ID,
			{ transcript_text: 'hello' } as never,
			5
		);
		expect(capturedPath).toBe(`/api/v1/meetings/${MEETING_ID}/transcript`);
		expect(capturedBody).toEqual({ transcript_text: 'hello' });
		expect(capturedIfMatch).toBe('"5"');
		expect(updated.id).toBe(MEETING_ID);
	});

	it('generateSummary posts an empty JSON body with If-Match', async () => {
		let capturedBody: unknown;
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/meetings/${MEETING_ID}/generate-summary`]: async (request) => {
				capturedBody = await request.json();
				capturedIfMatch = request.headers.get('If-Match');
				return { body: { data: meetingFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.meetings.generateSummary(MEETING_ID, 5);
		expect(capturedBody).toEqual({});
		expect(capturedIfMatch).toBe('"5"');
	});

	it('acceptTaskProposal posts to the proposal accept route with If-Match', async () => {
		let capturedPath = '';
		let capturedIdempotencyKey: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/meetings/${MEETING_ID}/task-proposals/${PROPOSAL_ID}/accept`]: async (
				request
			) => {
				capturedPath = new URL(request.url).pathname;
				capturedIdempotencyKey = request.headers.get('Idempotency-Key');
				return { body: { data: meetingFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const updated = await api.meetings.acceptTaskProposal(MEETING_ID, PROPOSAL_ID, 5);
		expect(capturedPath).toBe(
			`/api/v1/meetings/${MEETING_ID}/task-proposals/${PROPOSAL_ID}/accept`
		);
		expect(updated.id).toBe(MEETING_ID);
	});

	it('dismissTaskProposal posts to the proposal dismiss route with If-Match', async () => {
		let capturedPath = '';
		const fetchMock = createMockFetch({
			[`POST /api/v1/meetings/${MEETING_ID}/task-proposals/${PROPOSAL_ID}/dismiss`]: async (
				request
			) => {
				capturedPath = new URL(request.url).pathname;
				return { body: { data: meetingFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const updated = await api.meetings.dismissTaskProposal(MEETING_ID, PROPOSAL_ID, 5);
		expect(capturedPath).toBe(
			`/api/v1/meetings/${MEETING_ID}/task-proposals/${PROPOSAL_ID}/dismiss`
		);
		expect(updated.id).toBe(MEETING_ID);
	});

	it('delete sends If-Match and expects no content', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`DELETE /api/v1/meetings/${MEETING_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { status: 204 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.meetings.delete(MEETING_ID, 5);
		expect(capturedIfMatch).toBe('"5"');
	});
});
