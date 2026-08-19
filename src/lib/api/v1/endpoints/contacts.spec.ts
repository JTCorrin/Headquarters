import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const CONTACT_ID = '22222222-3333-4444-8555-666666666666';

describe('contacts.list', () => {
	it('passes client_id as a query filter', async () => {
		let seenClientId: string | null = null;

		const fetchMock = createMockFetch({
			'GET /api/v1/contacts': async (request) => {
				const url = new URL(request.url);
				seenClientId = url.searchParams.get('client_id');
				return {
					body: {
						data: [
							{
								id: CONTACT_ID,
								display_name: 'Ava Chen',
								client_id: CLIENT_ID,
								client_role: 'primary'
							}
						],
						meta: { next_cursor: null }
					}
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await client.contacts.list({ client_id: CLIENT_ID, limit: 50 });

		expect(seenClientId).toBe(CLIENT_ID);
		expect(listed.data[0]?.client_role).toBe('primary');
	});
});
