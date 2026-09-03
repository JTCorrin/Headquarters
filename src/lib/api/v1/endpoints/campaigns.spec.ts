import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CAMPAIGN_ID = '33333333-4444-4555-8666-777777777777';
const TEMPLATE_ID = '11111111-2222-4333-8444-555555555555';
const MAILBOX_ID = '44444444-5555-4666-8777-888888888888';
const TAG_ID = '55555555-6666-4777-8888-999999999999';

function campaignFixture(overrides: Record<string, unknown> = {}) {
	return {
		id: CAMPAIGN_ID,
		org_id: ORG_A,
		created_at: '2026-09-03T00:00:00Z',
		updated_at: '2026-09-03T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 4,
		name: 'Spring Shot',
		status: 'draft',
		template_id: TEMPLATE_ID,
		mailbox_id: MAILBOX_ID,
		scheduled_at: null,
		started_at: null,
		completed_at: null,
		last_error: null,
		tag_ids: [TAG_ID],
		entity_types: ['lead', 'contact'],
		recipient_counts: { pending: 0, sent: 0, skipped: 0, failed: 0, total: 0 },
		quota_remaining: 200,
		...overrides
	};
}

describe('campaigns endpoints', () => {
	it('list passes status filter', async () => {
		let seenQuery = '';
		const fetchMock = createMockFetch({
			'GET /api/v1/campaigns': async (request) => {
				seenQuery = new URL(request.url).search;
				return { body: { data: [campaignFixture()] } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.campaigns.list({ status: 'draft', limit: 25 });
		expect(seenQuery).toContain('status=draft');
		expect(seenQuery).toContain('limit=25');
		expect(listed.data[0]?.id).toBe(CAMPAIGN_ID);
	});

	it('create posts audience fields', async () => {
		let capturedBody: unknown;
		const fetchMock = createMockFetch({
			'POST /api/v1/campaigns': async (request) => {
				capturedBody = await request.json();
				return { status: 201, body: { data: campaignFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.campaigns.create({
			name: 'Spring Shot',
			template_id: TEMPLATE_ID,
			mailbox_id: MAILBOX_ID,
			tag_ids: [TAG_ID],
			entity_types: ['lead', 'contact']
		});
		expect(capturedBody).toEqual({
			name: 'Spring Shot',
			template_id: TEMPLATE_ID,
			mailbox_id: MAILBOX_ID,
			tag_ids: [TAG_ID],
			entity_types: ['lead', 'contact']
		});
	});

	it('update and delete send If-Match', async () => {
		const matches: string[] = [];
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/campaigns/${CAMPAIGN_ID}`]: async (request) => {
				matches.push(request.headers.get('If-Match') ?? '');
				return { body: { data: campaignFixture({ version: 5 }) } };
			},
			[`DELETE /api/v1/campaigns/${CAMPAIGN_ID}`]: async (request) => {
				matches.push(request.headers.get('If-Match') ?? '');
				return { status: 204, body: null };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.campaigns.update(CAMPAIGN_ID, { name: 'Renamed' }, 4);
		await api.campaigns.delete(CAMPAIGN_ID, 4);
		expect(matches).toEqual(['"4"', '"4"']);
	});

	it('launch posts send_immediately with If-Match', async () => {
		let path = '';
		let body: unknown;
		let ifMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/campaigns/${CAMPAIGN_ID}/launch`]: async (request) => {
				path = new URL(request.url).pathname;
				body = await request.json();
				ifMatch = request.headers.get('If-Match');
				return { body: { data: campaignFixture({ status: 'sending' }) } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const launched = await api.campaigns.launch(CAMPAIGN_ID, 4, { sendImmediately: false });
		expect(path).toBe(`/api/v1/campaigns/${CAMPAIGN_ID}/launch`);
		expect(body).toEqual({ send_immediately: false });
		expect(ifMatch).toBe('"4"');
		expect(launched.status).toBe('sending');
	});

	it('cancel posts with If-Match', async () => {
		let ifMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`POST /api/v1/campaigns/${CAMPAIGN_ID}/cancel`]: async (request) => {
				ifMatch = request.headers.get('If-Match');
				return { body: { data: campaignFixture({ status: 'cancelled' }) } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const cancelled = await api.campaigns.cancel(CAMPAIGN_ID, 4);
		expect(ifMatch).toBe('"4"');
		expect(cancelled.status).toBe('cancelled');
	});

	it('audiencePreview supports GET and POST', async () => {
		const preview = {
			total: 2,
			sendable: 1,
			skipped: 1,
			capped: false,
			sample: [],
			skipped_sample: []
		};
		let getCalled = false;
		let postBody: unknown;
		const fetchMock = createMockFetch({
			[`GET /api/v1/campaigns/${CAMPAIGN_ID}/audience-preview`]: async () => {
				getCalled = true;
				return { body: { data: preview } };
			},
			[`POST /api/v1/campaigns/${CAMPAIGN_ID}/audience-preview`]: async (request) => {
				postBody = await request.json();
				return { body: { data: preview } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.campaigns.audiencePreview(CAMPAIGN_ID);
		await api.campaigns.audiencePreview(CAMPAIGN_ID, {
			tag_ids: [TAG_ID],
			entity_types: ['contact']
		});
		expect(getCalled).toBe(true);
		expect(postBody).toEqual({ tag_ids: [TAG_ID], entity_types: ['contact'] });
	});

	it('listRecipients passes status query', async () => {
		let seenQuery = '';
		const fetchMock = createMockFetch({
			[`GET /api/v1/campaigns/${CAMPAIGN_ID}/recipients`]: async (request) => {
				seenQuery = new URL(request.url).search;
				return {
					body: {
						data: [
							{
								id: 'r1',
								campaign_id: CAMPAIGN_ID,
								status: 'pending',
								to_email: 'a@example.test'
							}
						]
					}
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.campaigns.listRecipients(CAMPAIGN_ID, {
			status: 'pending',
			limit: 10
		});
		expect(seenQuery).toContain('status=pending');
		expect(seenQuery).toContain('limit=10');
		expect(listed.data[0]?.to_email).toBe('a@example.test');
	});
});

describe('org mailboxes endpoints', () => {
	it('list hits organisation mailboxes route', async () => {
		let path = '';
		const fetchMock = createMockFetch({
			'GET /api/v1/organisation/mailboxes': async (request) => {
				path = new URL(request.url).pathname;
				return {
					body: {
						data: [
							{
								id: MAILBOX_ID,
								org_id: ORG_A,
								membership_id: 'm1',
								email_address: 'me@example.test',
								from_name: 'Me',
								status: 'active',
								member_display_name: 'Owner',
								created_at: '2026-09-03T00:00:00Z',
								updated_at: '2026-09-03T00:00:00Z'
							}
						]
					}
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.orgMailboxes.list();
		expect(path).toBe('/api/v1/organisation/mailboxes');
		expect(listed.data[0]?.email_address).toBe('me@example.test');
	});
});
