import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './sanitize-email-html.js';

describe('sanitizeEmailHtml', () => {
	it('keeps simple markup and drops scripts', () => {
		const html = '<p>Hello <strong>there</strong></p><script>alert(1)</script>';
		const out = sanitizeEmailHtml(html);
		expect(out).toContain('<p>Hello <strong>there</strong></p>');
		expect(out.toLowerCase()).not.toContain('script');
	});

	it('keeps data-image srcs and drops event handlers', () => {
		const html = '<img src="data:image/png;base64,abc" onerror="alert(1)" alt="cid">';
		const out = sanitizeEmailHtml(html);
		expect(out).toContain('data:image/png;base64,abc');
		expect(out.toLowerCase()).not.toContain('onerror');
	});
});
