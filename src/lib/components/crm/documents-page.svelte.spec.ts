import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import DocumentsPage from './documents-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FOLDER_ID = '11111111-2222-4333-8444-555555555555';
const DOC_ID = '22222222-3333-4444-8555-666666666666';
const LINK_ID = '33333333-4444-4555-8666-777777777777';

function memoryStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, value);
		},
		removeItem: (key: string) => {
			map.delete(key);
		}
	};
}

describe('DocumentsPage integration', () => {
	it('loads organisation document workspace with X-Org-Id', async () => {
		const seenOrgHeaders: string[] = [];
		const seenPaths: string[] = [];

		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					logo_url: null,
					role: 'owner',
					membership_id: 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm',
					theme_default: 'system'
				}
			]
		});

		const api = createApiV1Client({
			fetch: createMockFetch({
				[`GET /api/v1/entities/organisation/${ORG_A}/documents`]: async (request) => {
					seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
					seenPaths.push(new URL(request.url).pathname);
					return {
						body: {
							data: {
								folders: [
									{
										id: FOLDER_ID,
										org_id: ORG_A,
										created_at: '2026-08-01T00:00:00Z',
										updated_at: '2026-08-01T00:00:00Z',
										created_by: null,
										updated_by: null,
										deleted_at: null,
										version: 1,
										entity_type: 'organisation',
										entity_id: ORG_A,
										parent_id: null,
										name: 'Contracts'
									}
								],
								documents: [
									{
										document: {
											id: DOC_ID,
											org_id: ORG_A,
											created_at: '2026-08-01T00:00:00Z',
											updated_at: '2026-08-01T00:00:00Z',
											created_by: null,
											updated_by: null,
											deleted_at: null,
											version: 2,
											name: 'msa.pdf',
											category: 'contract',
											notes: null,
											bucket: 'org-documents',
											storage_path: `${ORG_A}/msa.pdf`,
											storage_version: null,
											mime_type: 'application/pdf',
											size_bytes: 2048,
											sha256: 'a'.repeat(64),
											uploaded_by: null,
											uploaded_at: '2026-08-01T01:00:00Z',
											scan_status: 'pending',
											metadata: {},
											status: 'ready',
											upload_expires_at: null
										},
										link: {
											id: LINK_ID,
											org_id: ORG_A,
											created_at: '2026-08-01T00:00:00Z',
											updated_at: '2026-08-01T00:00:00Z',
											created_by: null,
											updated_by: null,
											deleted_at: null,
											version: 3,
											document_id: DOC_ID,
											entity_type: 'organisation',
											entity_id: ORG_A,
											folder_id: null
										}
									}
								]
							}
						}
					};
				}
			}),
			getOrgId: () => session.selectedOrgId,
			getAccessToken: () => 'tok'
		});

		render(DocumentsPage, { api, session });

		await expect.element(page.getByTestId('documents-page')).toBeInTheDocument();
		await expect.element(page.getByTestId('entity-documents')).toBeInTheDocument();
		await expect.element(page.getByTestId(`documents-entry-${FOLDER_ID}`)).toBeInTheDocument();
		await expect.element(page.getByTestId(`documents-entry-${DOC_ID}`)).toBeInTheDocument();
		expect(seenOrgHeaders).toContain(ORG_A);
		expect(seenPaths).toContain(`/api/v1/entities/organisation/${ORG_A}/documents`);
	});
});
