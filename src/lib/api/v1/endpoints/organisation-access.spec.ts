import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_ID = '11111111-2222-4333-8444-555555555555';
const INVITATION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';

describe('organisation access endpoints', () => {
	it('uses org-scoped management routes and headerless acceptance', async () => {
		const seenHeaders: Array<string | null> = [];
		const fetchMock = createMockFetch({
			'POST /api/v1/organisation/invitations': async (request) => {
				seenHeaders.push(request.headers.get('x-org-id'));
				return {
					status: 201,
					body: {
						data: {
							id: INVITATION_ID,
							org_id: ORG_ID,
							email: 'invitee@example.test',
							role: 'member'
						}
					}
				};
			},
			'POST /api/v1/invitations/accept': async (request) => {
				seenHeaders.push(request.headers.get('x-org-id'));
				return {
					body: {
						data: {
							organisation_id: ORG_ID,
							membership_id: MEMBERSHIP_ID,
							role: 'member',
							status: 'active',
							joined_at: '2026-08-10T08:00:00.000Z'
						}
					}
				};
			},
			[`PATCH /api/v1/organisation/members/${MEMBERSHIP_ID}`]: async () => ({
				body: {
					data: {
						id: MEMBERSHIP_ID,
						org_id: ORG_ID,
						role: 'readonly',
						status: 'suspended'
					}
				}
			})
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_ID });

		const invitation = await api.organisationAccess.invite({
			email: 'invitee@example.test',
			role: 'member'
		});
		const accepted = await api.organisationAccess.acceptInvitation({ token: 'crm_inv_token' });
		const updated = await api.organisationAccess.updateMember(MEMBERSHIP_ID, {
			role: 'readonly',
			status: 'suspended'
		});

		expect(invitation.id).toBe(INVITATION_ID);
		expect(accepted.membership_id).toBe(MEMBERSHIP_ID);
		expect(updated.status).toBe('suspended');
		expect(seenHeaders).toEqual([ORG_ID, null]);
	});
});
