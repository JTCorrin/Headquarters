import { describe, expect, it } from 'vitest';
import { createApiV1Client } from './client.js';
import { createMockFetch } from './mock-fetch.js';
import { auditActionLabel, toAuditLogListItem } from './mappers.js';
import type { ApiAuditEvent } from './types.js';

const sample: ApiAuditEvent = {
	id: 'aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd',
	org_id: 'org-1',
	actor_type: 'user',
	actor_id: '11111111-2222-4333-8444-555555555555',
	action: 'org.config_updated',
	resource_type: 'organisation',
	resource_id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
	request_id: null,
	ip_address: '10.0.0.2',
	user_agent: null,
	before_data: null,
	after_data: null,
	metadata: { actor_name: 'Joe' },
	created_at: '2026-08-03T12:00:00.000Z'
};

describe('audit-events client + mappers', () => {
	it('lists with filter query params', async () => {
		let url = '';
		const fetchMock = createMockFetch({
			'GET /api/v1/audit-events': (request) => {
				url = request.url;
				return { status: 200, body: { data: [sample] } };
			}
		});
		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => 'org-1',
			getAccessToken: async () => 'tok'
		});

		const result = await api.auditEvents.list({
			limit: 50,
			from: '2026-08-01',
			to: '2026-08-03',
			action: 'org.config_updated',
			actor_id: sample.actor_id!
		});
		expect(result.data).toHaveLength(1);
		const parsed = new URL(url);
		expect(parsed.searchParams.get('from')).toBe('2026-08-01');
		expect(parsed.searchParams.get('to')).toBe('2026-08-03');
		expect(parsed.searchParams.get('action')).toBe('org.config_updated');
		expect(parsed.searchParams.get('actor_id')).toBe(sample.actor_id);
	});

	it('maps rows for the table', () => {
		expect(auditActionLabel('membership.role_changed')).toBe('Membership Role Changed');
		const row = toAuditLogListItem(sample);
		expect(row.event).toBe('Org Config Updated');
		expect(row.actor).toBe('Joe');
		expect(row.target).toContain('organisation');
		expect(row.ip).toBe('10.0.0.2');
	});
});
