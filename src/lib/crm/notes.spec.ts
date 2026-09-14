import { describe, expect, it } from 'vitest';
import type { ApiNote, ApiNoteListItem } from '$lib/api/v1/types.js';
import {
	NOTES_VIEW_MODE_STORAGE_KEY,
	formatRelativeTime,
	noteDisplayTitle,
	noteSaveStatusLabel,
	noteToListItem,
	readStoredNotesViewMode,
	sortNoteItems,
	toNoteBodyText,
	toNoteListItem,
	writeStoredNotesViewMode
} from './notes.js';

const NOW = new Date('2026-09-14T12:00:00Z');

function listItem(overrides: Partial<ApiNoteListItem> = {}): ApiNoteListItem {
	return {
		id: '11111111-2222-4333-8444-555555555555',
		org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		owner_membership_id: 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff',
		created_at: '2026-09-14T09:00:00Z',
		updated_at: '2026-09-14T09:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		title: 'Groceries',
		color: 'yellow',
		pinned: false,
		excerpt: 'Milk, eggs',
		...overrides
	};
}

function memoryStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, value);
		}
	};
}

describe('notes helpers', () => {
	it('formats relative time with sensible units', () => {
		expect(formatRelativeTime('2026-09-14T11:59:30Z', NOW)).toBe('just now');
		expect(formatRelativeTime('2026-09-14T11:30:00Z', NOW)).toBe('30 minutes ago');
		expect(formatRelativeTime('2026-09-14T09:00:00Z', NOW)).toBe('3 hours ago');
		expect(formatRelativeTime('2026-09-12T12:00:00Z', NOW)).toBe('2 days ago');
		expect(formatRelativeTime('not-a-date', NOW)).toBe('—');
	});

	it('falls back to Untitled for blank titles', () => {
		expect(noteDisplayTitle('  ')).toBe('Untitled');
		expect(noteDisplayTitle(' Plan ')).toBe('Plan');
	});

	it('maps list rows to UI items', () => {
		const item = toNoteListItem(listItem({ title: '', pinned: true }), NOW);
		expect(item).toMatchObject({
			id: '11111111-2222-4333-8444-555555555555',
			title: '',
			displayTitle: 'Untitled',
			excerpt: 'Milk, eggs',
			color: 'yellow',
			pinned: true,
			updatedAt: '2026-09-14T09:00:00Z',
			updatedLabel: '3 hours ago',
			version: 1
		});
	});

	it('derives an excerpt when mapping a full note', () => {
		const note: ApiNote = {
			...listItem(),
			body: { type: 'doc', content: [] },
			body_text: 'Line one\n\n  Line   two  ' + 'x'.repeat(400)
		};
		const item = noteToListItem(note, NOW);
		expect(item.excerpt.startsWith('Line one Line two')).toBe(true);
		expect(item.excerpt.length).toBe(280);
	});

	it('sorts pinned first, then newest updated', () => {
		const items = [
			toNoteListItem(listItem({ id: 'a', updated_at: '2026-09-14T08:00:00Z' }), NOW),
			toNoteListItem(
				listItem({ id: 'b', updated_at: '2026-09-14T07:00:00Z', pinned: true }),
				NOW
			),
			toNoteListItem(listItem({ id: 'c', updated_at: '2026-09-14T10:00:00Z' }), NOW)
		];
		expect(sortNoteItems(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
	});

	it('reads and writes the view mode preference', () => {
		const storage = memoryStorage();
		expect(readStoredNotesViewMode(storage)).toBe('grid');
		writeStoredNotesViewMode(storage, 'table');
		expect(storage.getItem(NOTES_VIEW_MODE_STORAGE_KEY)).toBe('table');
		expect(readStoredNotesViewMode(storage)).toBe('table');
		expect(readStoredNotesViewMode(memoryStorage({ [NOTES_VIEW_MODE_STORAGE_KEY]: 'x' }))).toBe(
			'grid'
		);
		expect(readStoredNotesViewMode(null)).toBe('grid');
	});

	it('labels save statuses', () => {
		expect(noteSaveStatusLabel('idle')).toBe('');
		expect(noteSaveStatusLabel('dirty')).toBe('Unsaved changes');
		expect(noteSaveStatusLabel('saving')).toBe('Saving…');
		expect(noteSaveStatusLabel('saved')).toBe('Saved');
		expect(noteSaveStatusLabel('error')).toBe('Couldn’t save');
		expect(noteSaveStatusLabel('conflict')).toBe('Changed elsewhere');
	});

	it('normalises body text and caps its length', () => {
		expect(toNoteBodyText('  a \t b\n\n\n\nc  ')).toBe('a b\n\nc');
		expect(toNoteBodyText('x'.repeat(20), 5)).toBe('xxxxx');
	});
});
