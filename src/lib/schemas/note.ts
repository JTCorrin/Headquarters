import { z } from 'zod';

export const noteColors = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'] as const;
export type NoteColor = (typeof noteColors)[number];

export interface NoteColorStyle {
	label: string;
	/** Sticky-note card surface (background + border + text). */
	card: string;
	/** Small swatch used in pickers and table cells. */
	swatch: string;
}

/** Palette shared by the masonry cards, the table swatch, and the editor picker. */
export const NOTE_COLORS: Record<NoteColor, NoteColorStyle> = {
	yellow: {
		label: 'Yellow',
		card: 'bg-amber-100 border-amber-200 text-amber-950 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-50',
		swatch: 'bg-amber-300 dark:bg-amber-500'
	},
	green: {
		label: 'Green',
		card: 'bg-emerald-100 border-emerald-200 text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-50',
		swatch: 'bg-emerald-300 dark:bg-emerald-500'
	},
	blue: {
		label: 'Blue',
		card: 'bg-sky-100 border-sky-200 text-sky-950 dark:bg-sky-950/40 dark:border-sky-900 dark:text-sky-50',
		swatch: 'bg-sky-300 dark:bg-sky-500'
	},
	pink: {
		label: 'Pink',
		card: 'bg-pink-100 border-pink-200 text-pink-950 dark:bg-pink-950/40 dark:border-pink-900 dark:text-pink-50',
		swatch: 'bg-pink-300 dark:bg-pink-500'
	},
	purple: {
		label: 'Purple',
		card: 'bg-violet-100 border-violet-200 text-violet-950 dark:bg-violet-950/40 dark:border-violet-900 dark:text-violet-50',
		swatch: 'bg-violet-300 dark:bg-violet-500'
	},
	gray: {
		label: 'Gray',
		card: 'bg-muted border-border text-foreground',
		swatch: 'bg-zinc-300 dark:bg-zinc-500'
	}
};

export const noteTitleSchema = z.string().max(200, 'Title must be 200 characters or fewer');
export const noteColorSchema = z.enum(noteColors);

/** Row shape for the notes table and masonry grid (UI-facing). */
export interface NoteListItem {
	id: string;
	title: string;
	/** Title with an "Untitled" fallback for display. */
	displayTitle: string;
	excerpt: string;
	color: NoteColor;
	pinned: boolean;
	updatedAt: string;
	/** Human-friendly relative label, e.g. "3 hours ago". */
	updatedLabel: string;
	version: number;
}

export type NotesViewMode = 'table' | 'grid';
