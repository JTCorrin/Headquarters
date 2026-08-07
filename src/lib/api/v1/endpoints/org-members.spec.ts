import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = '11111111-2222-4333-8444-555555555555';
const MEMBERSHIP_A = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const MEMBERSHIP_B = 'cccccccc-cccc-4ddd-8eee-000000000000';
const USER_A = 'dddddddd-dddd-4eee-8fff-111111111111';

describe('org-members endpoints', () => {
	it('lists active org members against GET /me/org-members', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/me/org-members': async () => ({
				body: {
					data: [
						{
							membership_id: MEMBERSHIP_A,
							user_id: USER_A,
							display_name: 'Ada Lovelace',
							role: 'owner',
							job_title: null
						},
						{
							membership_id: MEMBERSHIP_B,
							user_id: 'eeeeeeee-eeee-4fff-8000-222222222222',
							display_name: 'Grace Hopper',
							role: 'member',
							job_title: 'Engineer'
						}
					]
				}
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const members = await api.orgMembers.list();

		expect(members).toHaveLength(2);
		expect(members[0]?.display_name).toBe('Ada Lovelace');
		expect(members[1]?.membership_id).toBe(MEMBERSHIP_B);
		expect(members[1]?.role).toBe('member');
	});
});
