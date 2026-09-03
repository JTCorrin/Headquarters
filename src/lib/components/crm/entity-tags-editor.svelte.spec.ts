import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import EntityTagsEditor from './entity-tags-editor.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CONTACT_ID = '22222222-3333-4444-8555-666666666666';
const TAG_ID = '11111111-2222-4333-8444-555555555555';
const TAG_B = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111';

describe('EntityTagsEditor', () => {
	it('loads entity tags and replaces selection', async () => {
		let replaceBody: unknown;

		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/tags': async () => ({
					body: {
						data: [
							{
								id: TAG_ID,
								org_id: ORG_A,
								created_at: '2026-09-03T00:00:00Z',
								updated_at: '2026-09-03T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								name: 'Newsletter',
								color: null
							},
							{
								id: TAG_B,
								org_id: ORG_A,
								created_at: '2026-09-03T00:00:00Z',
								updated_at: '2026-09-03T00:00:00Z',
								created_by: null,
								updated_by: null,
								deleted_at: null,
								version: 1,
								name: 'Partners',
								color: null
							}
						]
					}
				}),
				[`GET /api/v1/contacts/${CONTACT_ID}/tags`]: async () => ({
					body: {
						data: [{ id: TAG_ID, name: 'Newsletter', color: null, version: 1 }]
					}
				}),
				[`PUT /api/v1/contacts/${CONTACT_ID}/tags`]: async (request) => {
					replaceBody = await request.json();
					return {
						body: {
							data: [
								{ id: TAG_ID, name: 'Newsletter', color: null, version: 1 },
								{ id: TAG_B, name: 'Partners', color: null, version: 1 }
							]
						}
					};
				}
			}),
			getOrgId: () => ORG_A,
			getAccessToken: () => 'tok'
		});

		render(EntityTagsEditor, {
			api,
			entityType: 'contact',
			entityId: CONTACT_ID,
			canEdit: true
		});

		await expect.element(page.getByTestId('entity-tags-editor')).toBeInTheDocument();
		await expect.element(page.getByText('Newsletter')).toBeInTheDocument();

		await page.getByTestId('entity-tags-edit').click();
		await page.getByText('Partners').click();

		await expect
			.poll(() => replaceBody)
			.toEqual({ tag_ids: [TAG_ID, TAG_B] });
	});
});
