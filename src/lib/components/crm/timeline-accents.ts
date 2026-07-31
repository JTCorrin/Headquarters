export type TimelineAccentId =
	| 'slate'
	| 'sky'
	| 'violet'
	| 'emerald'
	| 'amber'
	| 'orange'
	| 'indigo'
	| 'rose';

export interface TimelineAccent {
	id: TimelineAccentId;
	label: string;
	markerClass: string;
	swatchClass: string;
}

export const TIMELINE_ACCENTS: readonly TimelineAccent[] = [
	{ id: 'slate', label: 'Slate', markerClass: 'bg-muted-foreground', swatchClass: 'bg-muted-foreground' },
	{ id: 'sky', label: 'Sky', markerClass: 'bg-sky-500', swatchClass: 'bg-sky-500' },
	{ id: 'violet', label: 'Violet', markerClass: 'bg-violet-500', swatchClass: 'bg-violet-500' },
	{ id: 'emerald', label: 'Emerald', markerClass: 'bg-emerald-500', swatchClass: 'bg-emerald-500' },
	{ id: 'amber', label: 'Amber', markerClass: 'bg-amber-500', swatchClass: 'bg-amber-500' },
	{ id: 'orange', label: 'Orange', markerClass: 'bg-orange-500', swatchClass: 'bg-orange-500' },
	{ id: 'indigo', label: 'Indigo', markerClass: 'bg-indigo-500', swatchClass: 'bg-indigo-500' },
	{ id: 'rose', label: 'Rose', markerClass: 'bg-rose-500', swatchClass: 'bg-rose-500' }
] as const;

export function timelineAccentMarkerClass(accent?: string): string | undefined {
	const found = TIMELINE_ACCENTS.find((a) => a.id === accent);
	return found?.markerClass;
}

export type TimelineIconId =
	| 'note'
	| 'email'
	| 'call'
	| 'payment'
	| 'document'
	| 'status'
	| 'meeting'
	| 'task'
	| 'flag'
	| 'star'
	| 'alert';

export const TIMELINE_ICONS: readonly { id: TimelineIconId; label: string }[] = [
	{ id: 'note', label: 'Note' },
	{ id: 'email', label: 'Email' },
	{ id: 'call', label: 'Call' },
	{ id: 'meeting', label: 'Meeting' },
	{ id: 'task', label: 'Task' },
	{ id: 'document', label: 'Document' },
	{ id: 'payment', label: 'Payment' },
	{ id: 'status', label: 'Status' },
	{ id: 'flag', label: 'Flag' },
	{ id: 'star', label: 'Star' },
	{ id: 'alert', label: 'Alert' }
] as const;

/** Tiny markdown → HTML for timeline bodies (no external dep). */
export function renderTimelineMarkdown(source: string): string {
	const escaped = source
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');

	const withCode = escaped.replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 text-[0.85em]">$1</code>');
	const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	const withItalic = withBold.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
	const withLinks = withItalic.replace(
		/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
		'<a class="text-primary underline underline-offset-2" href="$2" target="_blank" rel="noreferrer">$1</a>'
	);

	const lines = withLinks.split('\n');
	const html: string[] = [];
	let inList = false;

	for (const line of lines) {
		const listMatch = line.match(/^[-*]\s+(.+)$/);
		if (listMatch) {
			if (!inList) {
				html.push('<ul class="my-1 list-disc space-y-0.5 pl-4">');
				inList = true;
			}
			html.push(`<li>${listMatch[1]}</li>`);
			continue;
		}
		if (inList) {
			html.push('</ul>');
			inList = false;
		}
		if (line.trim() === '') {
			html.push('<br />');
		} else {
			html.push(`<p class="my-0.5">${line}</p>`);
		}
	}
	if (inList) html.push('</ul>');
	return html.join('');
}
