import { describe, expect, it } from 'vitest';
import {
	ALLOWED_DOCUMENT_MIME_TYPES,
	isInlinePreviewMimeType,
	resolveDocumentMimeType
} from './document-mime.js';

describe('resolveDocumentMimeType', () => {
	it('keeps an allowed declared type', () => {
		expect(resolveDocumentMimeType({ name: 'a.pdf', type: 'application/pdf' })).toBe(
			'application/pdf'
		);
	});

	it('falls back to the extension when the browser reports nothing', () => {
		expect(resolveDocumentMimeType({ name: 'Mail.MSG', type: '' })).toBe(
			'application/vnd.ms-outlook'
		);
		expect(resolveDocumentMimeType({ name: 'call.vtt', type: '' })).toBe('text/vtt');
	});

	it('uses the extension type when the declared type is not allowed', () => {
		expect(resolveDocumentMimeType({ name: 'report.pdf', type: 'text/html' })).toBe(
			'application/pdf'
		);
	});

	it('rejects active content', () => {
		expect(resolveDocumentMimeType({ name: 'x.html', type: 'text/html' })).toBeNull();
		expect(resolveDocumentMimeType({ name: 'x.svg', type: 'image/svg+xml' })).toBeNull();
		expect(resolveDocumentMimeType({ name: 'x.bin', type: '' })).toBeNull();
		expect(ALLOWED_DOCUMENT_MIME_TYPES.has('image/svg+xml')).toBe(false);
	});
});

describe('isInlinePreviewMimeType', () => {
	it('allows PDF and raster images only', () => {
		expect(isInlinePreviewMimeType('image/jpeg; charset=binary')).toBe(true);
		expect(isInlinePreviewMimeType('application/pdf')).toBe(true);
		expect(isInlinePreviewMimeType('image/svg+xml')).toBe(false);
		expect(isInlinePreviewMimeType('text/plain')).toBe(false);
		expect(isInlinePreviewMimeType(null)).toBe(false);
	});
});
