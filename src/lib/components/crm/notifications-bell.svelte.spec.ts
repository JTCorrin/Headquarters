import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import NotificationsBell from './notifications-bell.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const NOTIF_ID = '11111111-2222-4333-8444-555555555555';
const MESSAGE_ID = '33333333-4444-4555-8666-777777777777';

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

describe('NotificationsBell', () => {
	it('shows unread badge, lists items, marks read, and deep-links to email', async () => {
		let patchBody: unknown;
		const onNavigate = vi.fn(() => Promise.resolve());
		const fetchMock = createMockFetch({
			'GET /api/v1/me/notifications/unread-count': async () => ({
				body: { data: { count: 1 } }
			}),
			'GET /api/v1/me/notifications': async () => ({
				body: { data: [sampleNotification()], meta: { next_cursor: null } }
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
		render(NotificationsBell, { api, orgId: ORG_A, onNavigate });

		await expect.element(page.getByTestId('notifications-badge')).toHaveTextContent('1');
		await page.getByTestId('notifications-bell').click();
		await expect.element(page.getByText('Kickoff pack')).toBeInTheDocument();
		await page.getByTestId('notification-item').click();

		await expect.poll(() => patchBody).toEqual({ read: true });
		await expect.poll(() => onNavigate.mock.calls.at(-1)?.[0]).toBe(
			`/email?message=${MESSAGE_ID}`
		);
	});
});
