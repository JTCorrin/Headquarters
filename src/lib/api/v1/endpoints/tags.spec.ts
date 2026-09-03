import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TAG_ID = '11111111-2222-4333-8444-555555555555';
const CONTACT_ID = '22222222-3333-4444-8555-666666666666';

function tagFixture(overrides: Record<string, unknown> = {}) {
	return {
		id: TAG_ID,
		org_id: ORG_A,
		created_at: '2026-09-03T00:00:00Z',
		updated_at: '2026-09-03T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 2,
		name: 'Newsletter',
		color: 'blue',
		...overrides
	};
}

describe('tags endpoints', () => {
	it('list passes limit', async () => {
		let seenQuery = '';
		const fetchMock = createMockFetch({
			'GET /api/v1/tags': async (request) => {
				seenQuery = new URL(request.url).search;
				return { body: { data: [tagFixture()] } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.tags.list({ limit: 50 });
		expect(seenQuery).toContain('limit=50');
		expect(listed.data[0]?.name).toBe('Newsletter');
	});

	it('create posts body and returns tag', async () => {
		let capturedBody: unknown;
		const fetchMock = createMockFetch({
			'POST /api/v1/tags': async (request) => {
				capturedBody = await request.json();
				return { status: 201, body: { data: tagFixture({ name: 'Partners' }) } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const created = await api.tags.create({ name: 'Partners', color: null });
		expect(capturedBody).toEqual({ name: 'Partners', color: null });
		expect(created.name).toBe('Partners');
	});

	it('update and delete send If-Match from version', async () => {
		const matches: string[] = [];
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/tags/${TAG_ID}`]: async (request) => {
				matches.push(request.headers.get('If-Match') ?? '');
				return { body: { data: tagFixture({ version: 3 }) } };
			},
			[`DELETE /api/v1/tags/${TAG_ID}`]: async (request) => {
				matches.push(request.headers.get('If-Match') ?? '');
				return { status: 204, body: null };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.tags.update(TAG_ID, { name: 'News' }, 2);
		await api.tags.delete(TAG_ID, 2);
		expect(matches).toEqual(['"2"', '"2"']);
	});

	it('listForEntity and replaceForEntity hit entity tag routes', async () => {
		let listedPath = '';
		let replacePath = '';
		let replaceBody: unknown;
		const fetchMock = createMockFetch({
			[`GET /api/v1/contacts/${CONTACT_ID}/tags`]: async (request) => {
				listedPath = new URL(request.url).pathname;
				return { body: { data: [{ id: TAG_ID, name: 'Newsletter', color: 'blue', version: 2 }] } };
			},
			[`PUT /api/v1/contacts/${CONTACT_ID}/tags`]: async (request) => {
				replacePath = new URL(request.url).pathname;
				replaceBody = await request.json();
				return {
					body: {
						data: [{ id: TAG_ID, name: 'Newsletter', color: 'blue', version: 2 }]
					}
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.tags.listForEntity('contact', CONTACT_ID);
		const replaced = await api.tags.replaceForEntity('contact', CONTACT_ID, [TAG_ID]);
		expect(listedPath).toBe(`/api/v1/contacts/${CONTACT_ID}/tags`);
		expect(replacePath).toBe(`/api/v1/contacts/${CONTACT_ID}/tags`);
		expect(replaceBody).toEqual({ tag_ids: [TAG_ID] });
		expect(listed.data[0]?.id).toBe(TAG_ID);
		expect(replaced[0]?.id).toBe(TAG_ID);
	});
});
