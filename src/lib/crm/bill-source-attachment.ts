import type { ApiV1Client } from '$lib/api/v1/client.js';
import type { ApiDocument } from '$lib/api/v1/types.js';
import { sha256HexSync } from '$lib/crypto/sha256-hex.js';

async function sha256Hex(data: ArrayBuffer): Promise<string> {
	if (globalThis.crypto?.subtle) {
		const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}
	return sha256HexSync(data);
}

export type BillSourceAttachmentMeta = {
	id: string;
	name: string;
	mimeType: string;
	version: number;
	sizeBytes: number;
};

const ACCEPTED_MIME_PREFIXES = ['image/'] as const;
const ACCEPTED_MIME_EXACT = new Set(['application/pdf']);

export function isBillSourceAttachmentFile(file: File): boolean {
	const mime = (file.type || '').toLowerCase().split(';')[0]?.trim() ?? '';
	if (ACCEPTED_MIME_EXACT.has(mime)) return true;
	return ACCEPTED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export function formatBillSourceAttachmentSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '—';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function putSignedUpload(
	fetchImpl: typeof fetch,
	signedUrl: string,
	file: File,
	signal?: AbortSignal
): Promise<void> {
	const response = await fetchImpl(signedUrl, {
		method: 'PUT',
		body: file,
		headers: {
			'Content-Type': file.type || 'application/octet-stream'
		},
		signal
	});
	if (!response.ok) {
		throw new Error(`Signed upload failed (${response.status})`);
	}
}

/** Upload a PDF/image to the bill entity workspace and return the ready document. */
export async function uploadBillSourceDocument(
	api: ApiV1Client,
	billId: string,
	file: File,
	options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<ApiDocument> {
	if (!isBillSourceAttachmentFile(file)) {
		throw new Error('Source attachment must be a PDF or image.');
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const buffer = await file.arrayBuffer();
	const digest = await sha256Hex(buffer);
	const intent = await api.documents.createUploadIntent(
		'bill',
		billId,
		{
			name: file.name.slice(0, 160) || 'bill-source',
			category: 'receipt',
			mime_type: file.type || 'application/octet-stream',
			size_bytes: file.size,
			sha256: digest,
			folder_id: null
		},
		options.signal
	);

	await putSignedUpload(fetchImpl, intent.upload.signed_url, file, options.signal);

	const finalized = await api.documents.finalize(
		intent.document.id,
		{
			expected_size_bytes: file.size,
			expected_sha256: digest
		},
		options.signal
	);
	return finalized.document;
}

/** Resolve display meta for the bill's linked source document (null when unset/missing). */
export async function loadBillSourceAttachmentMeta(
	api: ApiV1Client,
	billId: string,
	attachmentDocumentId: string | null | undefined,
	signal?: AbortSignal
): Promise<BillSourceAttachmentMeta | null> {
	if (!attachmentDocumentId) return null;

	try {
		const browse = await api.documents.browse('bill', billId, { folder_id: null }, signal);
		const hit = browse.documents.find((row) => row.document.id === attachmentDocumentId);
		if (hit) {
			return {
				id: hit.document.id,
				name: hit.document.name,
				mimeType: hit.document.mime_type,
				version: hit.document.version,
				sizeBytes: hit.document.size_bytes
			};
		}
	} catch {
		// Fall through to download metadata when browse is unavailable.
	}

	try {
		const download = await api.documents.download(attachmentDocumentId, signal);
		return {
			id: download.document_id,
			name: download.name,
			mimeType: download.mime_type,
			version: 1,
			sizeBytes: 0
		};
	} catch {
		return {
			id: attachmentDocumentId,
			name: 'Source document',
			mimeType: 'application/octet-stream',
			version: 1,
			sizeBytes: 0
		};
	}
}
