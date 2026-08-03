import { describe, expect, it } from 'vitest';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { ApiClientError } from '$lib/api/v1/errors.js';
import { apiError, createMockFetch } from '$lib/api/v1/mock-fetch.js';
import type { ApiTimelineEvent } from '$lib/api/v1/types.js';
import { createEntityTimelineEvent, loadEntityTimeline } from './entity-timeline.js';

const sampleRow: ApiTimelineEvent = {
	id: 'aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd',
	org_id: 'org-1',
	entity_type: 'quote',
	entity_id: 'quote-1',
	kind: 'conversion',
	title: 'Quote converted to invoice',
	body: null,
	actor_type: 'user',
	actor_id: 'user-1',
	source_type: 'quote',
	source_id: 'quote-1',
	payload: { action: 'quote.converted_to_invoice' },
	occurred_at: '2026-08-03T12:00:00.000Z',
	created_at: '2026-08-03T12:00:00.000Z'
};

describe('entity-timeline', () => {
	it('maps list rows including conversion kind', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/entities/quote/quote-1/timeline-events': () => ({
				status: 200,
				body: { data: [sampleRow] }
			})
		});
		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => 'org-1',
			getAccessToken: async () => 'tok'
		});

		const events = await loadEntityTimeline(api, 'quote', 'quote-1');
		expect(events).toHaveLength(1);
		expect(events[0]?.kind).toBe('conversion');
		expect(events[0]?.title).toBe('Quote converted to invoice');
		expect(events[0]?.icon).toBe('conversion');
	});

	it('soft-fails list to empty when the surface is missing', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/entities/contact/c1/timeline-events': () =>
				apiError(404, 'NOT_FOUND', 'missing')
		});
		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => 'org-1',
			getAccessToken: async () => 'tok'
		});

		await expect(loadEntityTimeline(api, 'contact', 'c1')).resolves.toEqual([]);
	});

	it('posts composer notes and maps the created card', async () => {
		const created: ApiTimelineEvent = {
			...sampleRow,
			id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			kind: 'note',
			title: 'Follow up',
			body: 'Called the client',
			payload: { accent: 'slate', icon: 'note' }
		};
		const fetchMock = createMockFetch({
			'POST /api/v1/entities/client/client-1/timeline-events': () => ({
				status: 201,
				body: { data: created }
			})
		});
		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => 'org-1',
			getAccessToken: async () => 'tok'
		});

		const event = await createEntityTimelineEvent(api, 'client', 'client-1', {
			kind: 'note',
			title: 'Follow up',
			body: 'Called the client',
			accent: 'slate',
			icon: 'note'
		});
		expect(event.kind).toBe('note');
		expect(event.title).toBe('Follow up');
	});

	it('rethrows unexpected list failures', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/entities/invoice/inv-1/timeline-events': () =>
				apiError(500, 'INTERNAL_ERROR', 'boom')
		});
		const api = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => 'org-1',
			getAccessToken: async () => 'tok'
		});

		await expect(loadEntityTimeline(api, 'invoice', 'inv-1')).rejects.toBeInstanceOf(
			ApiClientError
		);
	});
});
