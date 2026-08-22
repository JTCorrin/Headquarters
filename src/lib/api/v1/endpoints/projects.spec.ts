import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '../client.js';
import { createMockFetch } from '../mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PROJECT_ID = '55555555-3333-4444-8555-666666666666';
const COLUMN_ID = '55555555-4444-4555-8555-666666666666';
const CARD_ID = '55555555-5555-4666-8555-666666666666';

function projectFixture() {
	return {
		id: PROJECT_ID,
		version: 4,
		name: 'Website revamp',
		status: 'active',
		columns: [
			{ id: COLUMN_ID, name: 'To do', position: 0 },
			{
				id: '55555555-6666-4777-8555-666666666666',
				name: 'Done',
				position: 1,
				cards: [{ id: CARD_ID, title: 'Ship it', version: 2 }]
			}
		]
	};
}

describe('projects endpoints', () => {
	it('list passes client filter and returns projects', async () => {
		let seenQuery = '';
		const fetchMock = createMockFetch({
			'GET /api/v1/projects': async (request) => {
				seenQuery = new URL(request.url).search;
				return {
					body: {
						data: [projectFixture()],
						meta: { next_cursor: null }
					}
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const listed = await api.projects.list({ client_id: 'c9' });
		expect(seenQuery).toContain('client_id=c9');
		expect(listed.data[0]?.id).toBe(PROJECT_ID);
	});

	it('update sends If-Match from project version', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/projects/${PROJECT_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { body: { data: projectFixture() } };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.projects.update(PROJECT_ID, { name: 'Renamed' } as never, 4);
		expect(capturedIfMatch).toBe('"4"');
	});

	it('createColumn posts under the project', async () => {
		let capturedPath = '';
		let capturedBody: unknown;
		const fetchMock = createMockFetch({
			[`POST /api/v1/projects/${PROJECT_ID}/columns`]: async (request) => {
				capturedPath = new URL(request.url).pathname;
				capturedBody = await request.json();
				return {
					body: {
						data: { id: COLUMN_ID, name: 'Blocked', position: 2 }
					},
					status: 201
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const column = await api.projects.createColumn(PROJECT_ID, {
			name: 'Blocked'
		} as never);
		expect(capturedPath).toBe(`/api/v1/projects/${PROJECT_ID}/columns`);
		expect(capturedBody).toEqual({ name: 'Blocked' });
		expect(column.name).toBe('Blocked');
	});

	it('deleteColumn sends If-Match and expects no content', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`DELETE /api/v1/projects/${PROJECT_ID}/columns/${COLUMN_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { status: 204 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.projects.deleteColumn(PROJECT_ID, COLUMN_ID, 7);
		expect(capturedIfMatch).toBe('"7"');
	});

	it('createCard posts under the project cards collection', async () => {
		let capturedPath = '';
		const fetchMock = createMockFetch({
			[`POST /api/v1/projects/${PROJECT_ID}/cards`]: async (request) => {
				capturedPath = new URL(request.url).pathname;
				return {
					body: {
						data: { id: CARD_ID, title: 'New card', column_id: COLUMN_ID }
					},
					status: 201
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.projects.createCard(PROJECT_ID, {
			title: 'New card',
			column_id: COLUMN_ID
		} as never);
		expect(capturedPath).toBe(`/api/v1/projects/${PROJECT_ID}/cards`);
	});

	it('updateCard sends If-Match from card version', async () => {
		let capturedIfMatch: string | null = null;
		let capturedBody: unknown;
		const fetchMock = createMockFetch({
			[`PATCH /api/v1/projects/${PROJECT_ID}/cards/${CARD_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				capturedBody = await request.json();
				return {
					body: { data: { id: CARD_ID, title: 'Moved', version: 3 } }
				};
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const card = await api.projects.updateCard(
			PROJECT_ID,
			CARD_ID,
			{ column_id: COLUMN_ID } as never,
			2
		);
		expect(capturedIfMatch).toBe('"2"');
		expect(capturedBody).toEqual({ column_id: COLUMN_ID });
		expect(card.version).toBe(3);
	});

	it('deleteCard sends If-Match and expects no content', async () => {
		let capturedIfMatch: string | null = null;
		const fetchMock = createMockFetch({
			[`DELETE /api/v1/projects/${PROJECT_ID}/cards/${CARD_ID}`]: async (request) => {
				capturedIfMatch = request.headers.get('If-Match');
				return { status: 204 };
			}
		});
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await api.projects.deleteCard(PROJECT_ID, CARD_ID, 2);
		expect(capturedIfMatch).toBe('"2"');
	});
});
