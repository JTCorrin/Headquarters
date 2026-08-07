import { describe, expect, it } from 'vitest';
import { notificationDeepLink } from './notification-deep-link.js';
import type { ApiUserNotification } from '$lib/api/v1/types.js';

function row(overrides: Partial<ApiUserNotification> = {}): ApiUserNotification {
	return {
		id: 'n1',
		org_id: 'o1',
		kind: 'email.received',
		title: 'Hello',
		body: null,
		source_type: 'email_message',
		source_id: 'msg-1',
		read_at: null,
		created_at: '2026-08-07T00:00:00.000Z',
		...overrides
	};
}

describe('notificationDeepLink', () => {
	it('links email.received to the inbox message', () => {
		expect(notificationDeepLink(row())).toBe('/email?message=msg-1');
	});

	it('links timeline.mention to the entity timeline focus query', () => {
		expect(
			notificationDeepLink(
				row({
					kind: 'timeline.mention',
					source_type: 'timeline_event',
					source_id: 'evt-9',
					payload: {
						entity_type: 'client',
						entity_id: 'client-1',
						timeline_event_id: 'evt-9'
					}
				})
			)
		).toBe('/clients/client-1?timeline=evt-9');
	});

	it('returns null when mention payload is incomplete', () => {
		expect(
			notificationDeepLink(
				row({
					kind: 'timeline.mention',
					source_type: 'timeline_event',
					source_id: 'evt-9',
					payload: { entity_type: 'client' }
				})
			)
		).toBeNull();
	});
});
