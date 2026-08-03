import { describe, expect, it, vi } from 'vitest';
import {
	formatBillSourceAttachmentSize,
	isBillSourceAttachmentFile,
	loadBillSourceAttachmentMeta,
	uploadBillSourceDocument
} from './bill-source-attachment.js';

describe('bill source attachment helpers', () => {
	it('accepts pdf and images only', () => {
		expect(isBillSourceAttachmentFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(
			true
		);
		expect(isBillSourceAttachmentFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(true);
		expect(
			isBillSourceAttachmentFile(new File(['x'], 'a.txt', { type: 'text/plain' }))
		).toBe(false);
	});

	it('formats byte sizes', () => {
		expect(formatBillSourceAttachmentSize(512)).toBe('512 B');
		expect(formatBillSourceAttachmentSize(2048)).toBe('2.0 KB');
	});

	it('uploads via intent → put → finalize', async () => {
		const file = new File(['hello'], 'vendor.pdf', { type: 'application/pdf' });
		const createUploadIntent = vi.fn(async () => ({
			document: {
				id: 'doc-1',
				version: 1,
				name: 'vendor.pdf',
				mime_type: 'application/pdf',
				size_bytes: 5
			},
			link: { id: 'link-1' },
			upload: { signed_url: 'https://upload.test/put', token: 't', path: 'p', expires_in: 60 }
		}));
		const finalize = vi.fn(async () => ({
			document: {
				id: 'doc-1',
				version: 2,
				name: 'vendor.pdf',
				mime_type: 'application/pdf',
				size_bytes: 5
			}
		}));
		const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
		const api = {
			documents: { createUploadIntent, finalize }
		} as never;

		const doc = await uploadBillSourceDocument(api, 'bill-1', file, { fetchImpl });
		expect(createUploadIntent).toHaveBeenCalledWith(
			'bill',
			'bill-1',
			expect.objectContaining({
				name: 'vendor.pdf',
				category: 'receipt',
				mime_type: 'application/pdf',
				size_bytes: 5,
				folder_id: null
			}),
			undefined
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://upload.test/put',
			expect.objectContaining({ method: 'PUT' })
		);
		expect(finalize).toHaveBeenCalledWith(
			'doc-1',
			expect.objectContaining({ expected_size_bytes: 5 }),
			undefined
		);
		expect(doc.id).toBe('doc-1');
		expect(doc.version).toBe(2);
	});

	it('loads meta from browse when attachment id is set', async () => {
		const browse = vi.fn(async () => ({
			folders: [],
			documents: [
				{
					document: {
						id: 'doc-9',
						name: 'scan.pdf',
						mime_type: 'application/pdf',
						version: 3,
						size_bytes: 1024
					},
					link: { id: 'l1' }
				}
			]
		}));
		const api = { documents: { browse, download: vi.fn() } } as never;
		const meta = await loadBillSourceAttachmentMeta(api, 'bill-1', 'doc-9');
		expect(meta).toEqual({
			id: 'doc-9',
			name: 'scan.pdf',
			mimeType: 'application/pdf',
			version: 3,
			sizeBytes: 1024
		});
		expect(browse).toHaveBeenCalled();
	});
});
