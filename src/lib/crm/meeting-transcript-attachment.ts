import type { ApiV1Client } from '$lib/api/v1/client.js';
import type { ApiDocument, ApiMeetingDocument } from '$lib/api/v1/types.js';
import { sha256HexSync } from '$lib/crypto/sha256-hex.js';

async function sha256Hex(data: ArrayBuffer): Promise<string> {
	if (globalThis.crypto?.subtle) {
		const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}
	return sha256HexSync(data);
}

const ACCEPTED_MIME_EXACT = new Set([
	'text/plain',
	'text/markdown',
	'text/vtt',
	'application/pdf'
]);
const ACCEPTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.vtt', '.pdf']);

export function isMeetingTranscriptFile(file: File): boolean {
	const mime = (file.type || '').toLowerCase().split(';')[0]?.trim() ?? '';
	if (mime && ACCEPTED_MIME_EXACT.has(mime)) return true;
	const name = file.name.toLowerCase();
	const dot = name.lastIndexOf('.');
	if (dot < 0) return false;
	return ACCEPTED_EXTENSIONS.has(name.slice(dot));
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

/** Upload a transcript file onto the meeting document workspace and return the ready document. */
export async function uploadMeetingTranscriptDocument(
	api: ApiV1Client,
	meetingId: string,
	file: File,
	options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<ApiDocument> {
	if (!isMeetingTranscriptFile(file)) {
		throw new Error('Transcript must be a text, Markdown, VTT, or PDF file.');
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const buffer = await file.arrayBuffer();
	const digest = await sha256Hex(buffer);
	const intent = await api.documents.createUploadIntent(
		'meeting',
		meetingId,
		{
			name: file.name.slice(0, 160) || 'meeting-transcript',
			category: 'transcript',
			mime_type: file.type || 'text/plain',
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

async function extractPlainText(file: File): Promise<string | null> {
	const mime = (file.type || '').toLowerCase().split(';')[0]?.trim() ?? '';
	const name = file.name.toLowerCase();
	const isText =
		mime.startsWith('text/') ||
		name.endsWith('.txt') ||
		name.endsWith('.md') ||
		name.endsWith('.markdown') ||
		name.endsWith('.vtt');
	if (!isText) return null;
	const text = await file.text();
	return text.trim() ? text : null;
}

/** Upload + attach transcript to the meeting (M2 wire). */
export async function attachMeetingTranscriptFile(
	api: ApiV1Client,
	meeting: ApiMeetingDocument,
	file: File,
	options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<ApiMeetingDocument> {
	const document = await uploadMeetingTranscriptDocument(api, meeting.id, file, options);
	const plainText = await extractPlainText(file);
	return api.meetings.attachTranscript(
		meeting.id,
		{
			document_id: document.id,
			...(plainText
				? { plain_text: plainText, status: 'ready' as const }
				: {})
		},
		meeting.version,
		options.signal
	);
}
