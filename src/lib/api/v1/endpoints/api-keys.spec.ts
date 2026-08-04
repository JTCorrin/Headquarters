import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = '11111111-2222-4333-8444-555555555555';
const KEY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';

function sampleKey(overrides: Record<string, unknown> = {}) {
	return {
		id: KEY_ID,
		org_id: ORG_A,
		name: 'Buzz agent',
		prefix: 'crm_key_a1b2c3d4',
		role: 'member',
		scopes: [],
		expires_at: null,
		last_used_at: null,
		revoked_at: null,
		created_at: '2026-08-04T12:00:00.000Z',
		created_by: USER_ID,
		...overrides
	};
}

describe('api-keys endpoints', () => {
	it('lists, creates (reveal-once secret), and revokes against /api-keys', async () => {
		let createBody: unknown;

		const fetchMock = createMockFetch({
			'GET /api/v1/api-keys': async () => ({
				body: { data: [sampleKey()] }
			}),
			'POST /api/v1/api-keys': async (request) => {
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleKey({
							name: 'Cursor',
							secret: 'crm_key_' + 'ab'.repeat(16)
						})
					}
				};
			},
			[`DELETE /api/v1/api-keys/${KEY_ID}`]: async () => ({
				body: {
					data: sampleKey({ revoked_at: '2026-08-04T13:00:00.000Z' })
				}
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });

		const listed = await api.apiKeys.list();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.prefix).toBe('crm_key_a1b2c3d4');
		expect(listed[0]).not.toHaveProperty('secret');

		const created = await api.apiKeys.create({ name: 'Cursor', role: 'member' });
		expect(createBody).toEqual({ name: 'Cursor', role: 'member' });
		expect(created.secret).toMatch(/^crm_key_[0-9a-f]{32}$/);

		const revoked = await api.apiKeys.revoke(KEY_ID);
		expect(revoked.revoked_at).toBe('2026-08-04T13:00:00.000Z');
	});
});
