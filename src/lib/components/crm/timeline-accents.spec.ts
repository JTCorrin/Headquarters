import { describe, expect, it } from 'vitest';
import { renderTimelineMarkdown } from './timeline-accents.js';

describe('renderTimelineMarkdown', () => {
	it('renders basic formatting', () => {
		const html = renderTimelineMarkdown('**bold** and *italic* and `code`');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('>code</code>');
	});

	it('renders links with escaped ampersands in query strings', () => {
		const html = renderTimelineMarkdown('[docs](https://example.com/a?x=1&y=2)');
		expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"');
		expect(html).toContain('>docs</a>');
	});

	it('escapes HTML in the body', () => {
		const html = renderTimelineMarkdown('<img src=x onerror=alert(1)> "quoted" \'single\'');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
		expect(html).toContain('&quot;quoted&quot;');
		expect(html).toContain('&#39;single&#39;');
	});

	it('neutralises attribute injection through link URLs', () => {
		const html = renderTimelineMarkdown('[x](https://a"onpointerover=alert(1)//)');
		// The quote must stay entity-encoded inside the attribute value so it
		// cannot terminate href and introduce a new attribute.
		expect(html).not.toMatch(/href="[^"]*"\s*onpointerover/);
		expect(html).toContain('&quot;onpointerover');
	});

	it('renders list items and paragraphs', () => {
		const html = renderTimelineMarkdown('- one\n- two\n\nplain');
		expect(html).toContain('<li>one</li>');
		expect(html).toContain('<li>two</li>');
		expect(html).toContain('<p class="my-0.5">plain</p>');
	});
});
