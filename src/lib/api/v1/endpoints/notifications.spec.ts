import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const NOTIF_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORG_A = '11111111-2222-4333-8444-555555555555';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const MESSAGE_ID = 'cccccccc-dddd-4eee-8fff-000000000000';

function sampleNotification(overrides: Record<string, unknown> = {}) {
	return {
		id: NOTIF_ID,
		org_id: ORG_A,
		recipient_membership_id: MEMBERSHIP_ID,
		kind: 'email.received',
		title: 'Kickoff pack',
		body: 'From Northwind',
		source_type: 'email_message',
		source_id: MESSAGE_ID,
		read_at: null,
		created_at: '2026-08-04T12:00:00.000Z',
		...overrides
	};
}

describe('notifications endpoints', () => {
	it('lists, counts unread, and marks read against /me/notifications*', async () => {
		let patchBody: unknown;

		const fetchMock = createMockFetch({
			'GET /api/v1/me/notifications': async () => ({
				body: { data: [sampleNotification()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/me/notifications/unread-count': async () => ({
				body: { data: { count: 2 } }
			}),
			[`PATCH /api/v1/me/notifications/${NOTIF_ID}`]: async (request) => {
				patchBody = await request.json();
				return {
					body: {
						data: sampleNotification({ read_at: '2026-08-04T12:05:00.000Z' })
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });

		const listed = await api.notifications.list({ limit: 20 });
		expect(listed.data).toHaveLength(1);
		expect(listed.data[0]?.kind).toBe('email.received');

		const unread = await api.notifications.unreadCount();
		expect(unread.count).toBe(2);

		const marked = await api.notifications.markRead(NOTIF_ID);
		expect(patchBody).toEqual({ read: true });
		expect(marked.read_at).toBe('2026-08-04T12:05:00.000Z');
	});
});
