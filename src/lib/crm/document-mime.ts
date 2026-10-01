/**
 * Business file types accepted by the org-documents store. Must match
 * ALLOWED_DOCUMENT_MIME_TYPES in supabase/functions/api-v1/documents.ts and the
 * `org-documents` bucket `allowed_mime_types` (storage rejects anything else).
 */
const MIME_BY_EXTENSION: Record<string, string> = {
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	heic: 'image/heic',
	heif: 'image/heif',
	txt: 'text/plain',
	csv: 'text/csv',
	vtt: 'text/vtt',
	rtf: 'application/rtf',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	ppt: 'application/vnd.ms-powerpoint',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	odt: 'application/vnd.oasis.opendocument.text',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
	odp: 'application/vnd.oasis.opendocument.presentation',
	eml: 'message/rfc822',
	msg: 'application/vnd.ms-outlook'
};

export const ALLOWED_DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set(
	Object.values(MIME_BY_EXTENSION)
);

/** Types safe to render inline (lightbox / iframe). Never SVG or HTML. */
const INLINE_PREVIEW_MIME_TYPES: ReadonlySet<string> = new Set([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp'
]);

/** Value for `<input type="file" accept>` covering every allowed document type. */
export const DOCUMENT_ACCEPT = Object.keys(MIME_BY_EXTENSION)
	.map((ext) => `.${ext}`)
	.join(',');

export const UNSUPPORTED_DOCUMENT_TYPE_MESSAGE =
	'File type not supported. Upload PDF, images, Office/OpenDocument, text, CSV or email files.';

export function normalizeMimeType(mimeType: string | null | undefined): string {
	return (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
}

export function isInlinePreviewMimeType(mimeType: string | null | undefined): boolean {
	return INLINE_PREVIEW_MIME_TYPES.has(normalizeMimeType(mimeType));
}

/**
 * MIME type to declare for an upload, or null when the file is not an allowed
 * business document. Browsers report an empty or vendor type for many files
 * (.msg, .vtt, .csv on Windows), so the extension is the fallback.
 */
export function resolveDocumentMimeType(file: { name: string; type: string }): string | null {
	const declared = normalizeMimeType(file.type);
	if (ALLOWED_DOCUMENT_MIME_TYPES.has(declared)) return declared;
	const ext = file.name.toLowerCase().split('.').pop() ?? '';
	return MIME_BY_EXTENSION[ext] ?? null;
}
