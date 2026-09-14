import type { ColumnDef } from '@tanstack/table-core';
import type { NoteListItem } from '$lib/schemas/note.js';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import NoteTitleLink from './note-title-link.svelte';
import NoteExcerptCell from './note-excerpt-cell.svelte';
import type { DataTableFacet } from './data-table-facets.js';

export type NoteRow = NoteListItem;

export interface NoteColumnHandlers {
	onOpen?: (id: string) => void;
	onDelete?: (id: string) => void;
}

export const PINNED_LABEL = 'Pinned';
export const UNPINNED_LABEL = 'Not pinned';

export const notePinnedFacet: DataTableFacet = {
	column: 'pinned',
	label: 'Pinned',
	options: [
		{ value: PINNED_LABEL, label: PINNED_LABEL },
		{ value: UNPINNED_LABEL, label: UNPINNED_LABEL }
	]
};

export function createNoteColumns(handlers: NoteColumnHandlers = {}): ColumnDef<NoteRow>[] {
	const { onOpen, onDelete } = handlers;
	return [
		{
			id: 'title',
			accessorKey: 'displayTitle',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Note',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) =>
				renderComponent(NoteTitleLink, {
					id: row.original.id,
					title: row.original.displayTitle,
					color: row.original.color,
					pinned: row.original.pinned
				})
		},
		{
			accessorKey: 'excerpt',
			header: 'Preview',
			enableSorting: false,
			cell: ({ row }) => renderComponent(NoteExcerptCell, { excerpt: row.original.excerpt })
		},
		{
			id: 'pinned',
			accessorFn: (row) => (row.pinned ? PINNED_LABEL : UNPINNED_LABEL),
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Pinned',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) => (row.original.pinned ? PINNED_LABEL : '—')
		},
		{
			id: 'updated',
			accessorKey: 'updatedAt',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Updated',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) => row.original.updatedLabel
		},
		{
			id: 'actions',
			enableHiding: false,
			cell: ({ row }) =>
				renderComponent(DataTableRowActions, {
					id: row.original.id,
					label: 'note',
					viewHref: `/notes/${row.original.id}`,
					onEdit: onOpen ? () => onOpen(row.original.id) : undefined,
					onDelete: onDelete ? () => onDelete(row.original.id) : undefined
				})
		}
	];
}
