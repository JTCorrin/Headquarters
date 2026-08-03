export type TimelineEventKind =
	| 'note'
	| 'email'
	| 'call'
	| 'payment'
	| 'document'
	| 'status'
	| 'meeting'
	| 'task'
	| 'conversion';

/** All known kinds (including system-only). */
export const TIMELINE_EVENT_KINDS: readonly TimelineEventKind[] = [
	'note',
	'email',
	'call',
	'payment',
	'document',
	'status',
	'meeting',
	'task',
	'conversion'
] as const;

/** Composer-selectable kinds — system kinds (e.g. conversion) are writers-only. */
export const COMPOSABLE_TIMELINE_EVENT_KINDS: readonly TimelineEventKind[] = [
	'note',
	'email',
	'call',
	'payment',
	'document',
	'status',
	'meeting',
	'task'
] as const;

export interface TimelineKindMeta {
	label: string;
	/** Tailwind classes for the rail marker */
	markerClass: string;
}

export const TIMELINE_KIND_META: Record<TimelineEventKind, TimelineKindMeta> = {
	note: { label: 'Note', markerClass: 'bg-muted-foreground' },
	email: { label: 'Email', markerClass: 'bg-sky-500' },
	call: { label: 'Call', markerClass: 'bg-violet-500' },
	payment: { label: 'Payment', markerClass: 'bg-emerald-500' },
	document: { label: 'Document', markerClass: 'bg-amber-500' },
	status: { label: 'Status', markerClass: 'bg-orange-500' },
	meeting: { label: 'Meeting', markerClass: 'bg-indigo-500' },
	task: { label: 'Task', markerClass: 'bg-rose-500' },
	conversion: { label: 'Conversion', markerClass: 'bg-fuchsia-500' }
};

export function isTimelineEventKind(value: string): value is TimelineEventKind {
	return (TIMELINE_EVENT_KINDS as readonly string[]).includes(value);
}

export function isComposableTimelineEventKind(value: string): value is TimelineEventKind {
	return (COMPOSABLE_TIMELINE_EVENT_KINDS as readonly string[]).includes(value);
}

export function timelineKindLabel(kind: string): string {
	if (isTimelineEventKind(kind)) return TIMELINE_KIND_META[kind].label;
	return kind;
}

export function timelineKindMarkerClass(kind: string): string {
	if (isTimelineEventKind(kind)) return TIMELINE_KIND_META[kind].markerClass;
	return 'bg-muted-foreground';
}
