import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = '11111111-2222-4333-8444-555555555555';
const PARENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OUTBOUND_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

describe('emailMessages.reply', () => {
	it('POSTs body_text with Idempotency-Key to /email-messages/{id}/reply', async () => {
		let capturedHeaders: Headers | undefined;
		let capturedBody: unknown;

		const fetchMock = createMockFetch({
			[`POST /api/v1/email-messages/${PARENT_ID}/reply`]: async (request) => {
				capturedHeaders = request.headers;
				capturedBody = await request.json();
				return {
					body: {
						data: {
							id: OUTBOUND_ID,
							direction: 'outbound',
							from_address: 'me@example.com',
							subject: 'Re: Hello',
							body_text: 'Thanks',
							status: 'sent',
							in_reply_to_message_id: PARENT_ID
						}
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const sent = await api.emailMessages.reply(PARENT_ID, { body_text: 'Thanks' });

		expect(capturedBody).toEqual({ body_text: 'Thanks' });
		expect(capturedHeaders?.get('Idempotency-Key')).toBeTruthy();
		expect(sent.id).toBe(OUTBOUND_ID);
		expect(sent.status).toBe('sent');
	});
});
