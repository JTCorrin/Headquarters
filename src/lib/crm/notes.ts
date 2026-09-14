import type { ApiNote, ApiNoteDocument, ApiNoteListItem } from '$lib/api/v1/types.js';
import type { NoteListItem, NotesViewMode } from '$lib/schemas/note.js';

export const UNTITLED_NOTE = 'Untitled';
export const EMPTY_NOTE_DOCUMENT: ApiNoteDocument = { type: 'doc', content: [] };
export const NOTES_VIEW_MODE_STORAGE_KEY = 'hq.notes.viewMode';

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
	['year', 1000 * 60 * 60 * 24 * 365],
	['month', 1000 * 60 * 60 * 24 * 30],
	['week', 1000 * 60 * 60 * 24 * 7],
	['day', 1000 * 60 * 60 * 24],
	['hour', 1000 * 60 * 60],
	['minute', 1000 * 60]
];

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return '—';
	const diff = then - now.getTime();
	if (Math.abs(diff) < 60_000) return 'just now';
	const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	for (const [unit, ms] of RELATIVE_UNITS) {
		if (Math.abs(diff) >= ms) {
			return formatter.format(Math.round(diff / ms), unit);
		}
	}
	return 'just now';
}

export function noteDisplayTitle(title: string): string {
	const trimmed = title.trim();
	return trimmed.length > 0 ? trimmed : UNTITLED_NOTE;
}

export function toNoteListItem(note: ApiNoteListItem, now: Date = new Date()): NoteListItem {
	return {
		id: note.id,
		title: note.title,
		displayTitle: noteDisplayTitle(note.title),
		excerpt: note.excerpt,
		color: note.color,
		pinned: note.pinned,
		updatedAt: note.updated_at,
		updatedLabel: formatRelativeTime(note.updated_at, now),
		version: note.version
	};
}

/** Builds a list item from a full note, e.g. after a create/update round-trip. */
export function noteToListItem(note: ApiNote, now: Date = new Date()): NoteListItem {
	return toNoteListItem(
		{
			...note,
			excerpt: note.body_text.replace(/\s+/g, ' ').trim().slice(0, 280)
		},
		now
	);
}

/** Pinned first, then most recently updated; mirrors the API ordering for local edits. */
export function sortNoteItems(items: NoteListItem[]): NoteListItem[] {
	return [...items].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
		return byUpdated !== 0 ? byUpdated : b.id.localeCompare(a.id);
	});
}

export type NoteSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export function noteSaveStatusLabel(status: NoteSaveStatus): string {
	switch (status) {
		case 'dirty':
			return 'Unsaved changes';
		case 'saving':
			return 'Saving…';
		case 'saved':
			return 'Saved';
		case 'error':
			return 'Couldn’t save';
		case 'conflict':
			return 'Changed elsewhere';
		default:
			return '';
	}
}

/** Plain-text body for search/excerpts: collapse whitespace and cap at the API limit. */
export function toNoteBodyText(text: string, max = 100_000): string {
	const collapsed = text
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
}

export function isNotesViewMode(value: unknown): value is NotesViewMode {
	return value === 'table' || value === 'grid';
}

export function readStoredNotesViewMode(storage: Pick<Storage, 'getItem'> | null): NotesViewMode {
	try {
		const stored = storage?.getItem(NOTES_VIEW_MODE_STORAGE_KEY);
		return isNotesViewMode(stored) ? stored : 'grid';
	} catch {
		return 'grid';
	}
}

export function writeStoredNotesViewMode(
	storage: Pick<Storage, 'setItem'> | null,
	mode: NotesViewMode
): void {
	try {
		storage?.setItem(NOTES_VIEW_MODE_STORAGE_KEY, mode);
	} catch {
		// Storage may be unavailable (private mode, quota); the toggle still works in-memory.
	}
}
