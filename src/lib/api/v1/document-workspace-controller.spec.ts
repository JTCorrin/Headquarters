import { describe, expect, it, vi } from 'vitest';
import { createApiV1Client } from './client.js';
import {
	createDocumentWorkspaceController,
	formatDocumentSizeLabel,
	mapBrowseToWorkspaceView,
	sha256Hex
} from './document-workspace-controller.svelte.js';
import { createMockFetch } from './mock-fetch.js';
import type { ApiDocumentBrowseResult } from './types.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ENTITY_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const FOLDER_ID = '11111111-2222-4333-8444-555555555555';
const DOC_ID = '22222222-3333-4444-8555-666666666666';
const LINK_ID = '33333333-4444-4555-8666-777777777777';

const sampleBrowse: ApiDocumentBrowseResult = {
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
			entity_type: 'client',
			entity_id: ENTITY_ID,
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
				entity_type: 'client',
				entity_id: ENTITY_ID,
				folder_id: null
			}
		}
	]
};

describe('document workspace helpers', () => {
	it('formats byte sizes for view models', () => {
		expect(formatDocumentSizeLabel(512)).toBe('512 B');
		expect(formatDocumentSizeLabel(2048)).toBe('2.0 KB');
		expect(formatDocumentSizeLabel(1_572_864)).toBe('1.5 MB');
	});

	it('hashes file bytes as lowercase hex sha-256', async () => {
		const bytes = new TextEncoder().encode('hello');
		const digest = await sha256Hex(bytes.buffer);
		expect(digest).toMatch(/^[a-f0-9]{64}$/);
		expect(digest).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
	});

	it('maps browse payload onto DocumentWorkspace view models', () => {
		const mapped = mapBrowseToWorkspaceView(sampleBrowse, [
			{ id: null, name: 'Documents' }
		]);
		expect(mapped.view.kind).toBe('ready');
		if (mapped.view.kind !== 'ready') return;
		expect(mapped.view.entries).toHaveLength(2);
		expect(mapped.view.entries[0]).toMatchObject({
			kind: 'folder',
			id: FOLDER_ID,
			name: 'Contracts'
		});
		expect(mapped.view.entries[1]).toMatchObject({
			kind: 'file',
			id: DOC_ID,
			name: 'msa.pdf',
			category: 'contract',
			sizeLabel: '2.0 KB'
		});
		expect(mapped.metaById.get(DOC_ID)).toMatchObject({
			kind: 'file',
			version: 2,
			linkVersion: 3
		});
		expect(mapped.moveTargets).toEqual(
			expect.arrayContaining([
				{ id: null, name: 'Entity root' },
				{ id: FOLDER_ID, name: 'Contracts' }
			])
		);
	});
});

describe('createDocumentWorkspaceController', () => {
	it('loads browse into ready view and moves files with link If-Match', async () => {
		const fetchMock = createMockFetch({
			[`GET /api/v1/entities/client/${ENTITY_ID}/documents`]: async () => ({
				body: { data: sampleBrowse }
			}),
			[`POST /api/v1/documents/${DOC_ID}/move`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"3"');
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const body = await request.json();
				expect(body).toEqual({
					entity_type: 'client',
					entity_id: ENTITY_ID,
					folder_id: FOLDER_ID
				});
				return {
					headers: { etag: '"4"' },
					body: {
						data: {
							link: {
								...sampleBrowse.documents[0]!.link,
								folder_id: FOLDER_ID,
								version: 4
							}
						}
					}
				};
			}
		});

		const client = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => ORG_A,
			getAccessToken: () => 'tok'
		});

		const controller = createDocumentWorkspaceController({
			client,
			entityType: 'client',
			entityId: ENTITY_ID
		});

		await vi.waitFor(() => {
			expect(controller.view.kind).toBe('ready');
		});

		await controller.move(DOC_ID, FOLDER_ID);
		await vi.waitFor(() => {
			expect(controller.view.kind).toBe('ready');
		});
	});

	it('runs upload intent → signed PUT → finalize and refreshes browse', async () => {
		const putCalls: Request[] = [];
		let browseCalls = 0;

		const fetchMock = createMockFetch({
			[`GET /api/v1/entities/client/${ENTITY_ID}/documents`]: async () => {
				browseCalls += 1;
				return { body: { data: sampleBrowse } };
			},
			[`POST /api/v1/entities/client/${ENTITY_ID}/documents/upload-intent`]: async (
				request
			) => {
				const body = await request.json();
				expect(body.name).toBe('brief.pdf');
				expect(body.category).toBe('other');
				expect(body.size_bytes).toBe(5);
				expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
				expect(body.folder_id).toBeNull();
				return {
					status: 201,
					headers: { etag: '"1"' },
					body: {
						data: {
							document: {
								...sampleBrowse.documents[0]!.document,
								id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
								status: 'pending_upload',
								version: 1
							},
							link: sampleBrowse.documents[0]!.link,
							upload: {
								signed_url: 'https://storage.example.test/put',
								token: 'upload-token',
								path: 'org/path',
								expires_in: 3600
							}
						}
					}
				};
			},
			'POST /api/v1/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/finalize': async (
				request
			) => {
				const body = await request.json();
				expect(body.expected_size_bytes).toBe(5);
				expect(body.expected_sha256).toMatch(/^[a-f0-9]{64}$/);
				return {
					body: {
						data: {
							document: {
								...sampleBrowse.documents[0]!.document,
								id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
								status: 'ready',
								version: 2
							}
						}
					}
				};
			}
		});

		const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			putCalls.push(request);
			expect(request.method).toBe('PUT');
			expect(request.url).toBe('https://storage.example.test/put');
			return new Response(null, { status: 200 });
		});

		const client = createApiV1Client({
			fetch: fetchMock,
			getOrgId: () => ORG_A
		});

		const controller = createDocumentWorkspaceController({
			client,
			entityType: 'client',
			entityId: ENTITY_ID,
			uploadFetch,
			createId: () => 'upload-1'
		});

		await vi.waitFor(() => expect(controller.view.kind).toBe('ready'));

		const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'brief.pdf', {
			type: 'application/pdf'
		});
		controller.uploadFiles([file]);

		await vi.waitFor(() => {
			const item = controller.uploads.find((u) => u.id === 'upload-1');
			expect(item?.status).toBe('complete');
			expect(item?.progress).toBe(100);
		});

		expect(putCalls).toHaveLength(1);
		expect(browseCalls).toBeGreaterThanOrEqual(2);
	});

	it('marks upload failed when signed PUT fails and supports retry', async () => {
		let putShouldFail = true;
		let intentCalls = 0;

		const fetchMock = createMockFetch({
			[`GET /api/v1/entities/client/${ENTITY_ID}/documents`]: async () => ({
				body: { data: { folders: [], documents: [] } }
			}),
			[`POST /api/v1/entities/client/${ENTITY_ID}/documents/upload-intent`]: async () => {
				intentCalls += 1;
				return {
					status: 201,
					body: {
						data: {
							document: {
								...sampleBrowse.documents[0]!.document,
								id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
								status: 'pending_upload'
							},
							link: sampleBrowse.documents[0]!.link,
							upload: {
								signed_url: 'https://storage.example.test/put',
								token: 't',
								path: 'p',
								expires_in: 3600
							}
						}
					}
				};
			},
			'POST /api/v1/documents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/finalize': async () => ({
				body: {
					data: {
						document: {
							...sampleBrowse.documents[0]!.document,
							id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
							status: 'ready'
						}
					}
				}
			})
		});

		const uploadFetch = vi.fn(async () => {
			if (putShouldFail) {
				return new Response('nope', { status: 403 });
			}
			return new Response(null, { status: 200 });
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const controller = createDocumentWorkspaceController({
			client,
			entityType: 'client',
			entityId: ENTITY_ID,
			uploadFetch,
			createId: () => 'upload-retry'
		});

		await vi.waitFor(() => expect(controller.view.kind).toBe('ready'));
		controller.uploadFiles([
			new File([new Uint8Array([9])], 'retry.bin', { type: 'application/octet-stream' })
		]);

		await vi.waitFor(() => {
			expect(controller.uploads[0]?.status).toBe('failed');
		});
		expect(intentCalls).toBe(1);

		putShouldFail = false;
		controller.retryUpload('upload-retry');

		await vi.waitFor(() => {
			expect(controller.uploads[0]?.status).toBe('complete');
		});
		expect(intentCalls).toBe(2);
	});
});
