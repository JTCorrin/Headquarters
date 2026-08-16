const ALLOWED_TAGS = new Set([
	'A',
	'P',
	'BR',
	'DIV',
	'SPAN',
	'B',
	'STRONG',
	'I',
	'EM',
	'U',
	'UL',
	'OL',
	'LI',
	'TABLE',
	'THEAD',
	'TBODY',
	'TR',
	'TD',
	'TH',
	'IMG',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'BLOCKQUOTE',
	'PRE',
	'CODE',
	'HR'
]);

const ALLOWED_ATTR: Record<string, Set<string>> = {
	A: new Set(['href', 'title']),
	IMG: new Set(['src', 'alt', 'width', 'height']),
	TD: new Set(['colspan', 'rowspan']),
	TH: new Set(['colspan', 'rowspan'])
};

function isSafeHref(value: string): boolean {
	const v = value.trim().toLowerCase();
	return (
		v.startsWith('http://') ||
		v.startsWith('https://') ||
		v.startsWith('mailto:') ||
		v.startsWith('#')
	);
}

function isSafeImgSrc(value: string): boolean {
	const v = value.trim().toLowerCase();
	return v.startsWith('https://') || v.startsWith('http://') || v.startsWith('data:image/');
}

function allowedAttr(tag: string, attrName: string): boolean {
	const allowed = ALLOWED_ATTR[tag];
	if (!allowed) return false;
	return allowed.has(attrName.toLowerCase());
}

function sanitizeElement(el: Element): void {
	const children = [...el.children];
	for (const child of children) {
		sanitizeElement(child);
		if (!ALLOWED_TAGS.has(child.tagName)) {
			child.replaceWith(...child.childNodes);
			continue;
		}
		for (const attr of [...child.attributes]) {
			const name = attr.name.toLowerCase();
			if (name.startsWith('on') || name === 'style' || !allowedAttr(child.tagName, name)) {
				child.removeAttribute(attr.name);
				continue;
			}
			if (name === 'href' && !isSafeHref(attr.value)) child.removeAttribute(attr.name);
			if (name === 'src' && child.tagName === 'IMG' && !isSafeImgSrc(attr.value)) {
				child.removeAttribute(attr.name);
			}
		}
	}
}

/** Allowlisted HTML for inbound email bodies. Strips scripts, handlers, and unsafe URLs. */
export function sanitizeEmailHtml(html: string): string {
	const input = html.trim();
	if (!input) return '';
	if (typeof DOMParser === 'undefined') {
		return input
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
	const doc = new DOMParser().parseFromString(input, 'text/html');
	for (const node of [...doc.querySelectorAll('script, style, iframe, object, embed, link, meta')]) {
		node.remove();
	}
	sanitizeElement(doc.body);
	return doc.body.innerHTML;
}
