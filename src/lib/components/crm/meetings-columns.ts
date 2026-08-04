import type { ColumnDef } from '@tanstack/table-core';
import type { MeetingListItem } from '$lib/schemas/meeting.js';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import MeetingTitleLink from './meeting-title-link.svelte';

export type MeetingRow = MeetingListItem;

export interface MeetingColumnHandlers {
	onEdit?: (id: string) => void;
	onDelete?: (id: string) => void;
}

export function createMeetingColumns(handlers: MeetingColumnHandlers = {}): ColumnDef<MeetingRow>[] {
	const { onEdit, onDelete } = handlers;
	return [
		{
			id: 'select',
			header: ({ table }) =>
				renderComponent(DataTableCheckbox, {
					checked: table.getIsAllPageRowsSelected(),
					indeterminate:
						table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(),
					onCheckedChange: (value) => table.toggleAllPageRowsSelected(!!value),
					'aria-label': 'Select all'
				}),
			cell: ({ row }) =>
				renderComponent(DataTableCheckbox, {
					checked: row.getIsSelected(),
					onCheckedChange: (value) => row.toggleSelected(!!value),
					'aria-label': 'Select row'
				}),
			enableSorting: false,
			enableHiding: false
		},
		{
			accessorKey: 'title',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Meeting',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) =>
				renderComponent(MeetingTitleLink, {
					id: row.original.id,
					title: row.original.title
				})
		},
		{
			accessorKey: 'when',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'When',
					onclick: column.getToggleSortingHandler()
				})
		},
		{
			accessorKey: 'withWhom',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'With',
					onclick: column.getToggleSortingHandler()
				})
		},
		{
			accessorKey: 'relatedTo',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Related',
					onclick: column.getToggleSortingHandler()
				})
		},
		{
			accessorKey: 'status',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Status',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) => renderComponent(StatusBadge, { status: row.original.status })
		},
		{
			id: 'calendarLink',
			accessorFn: (row) => (row.calendarProvider ? 'Linked' : ''),
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Calendar',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) =>
				row.original.calendarProvider
					? renderComponent(StatusBadge, { status: 'Linked' })
					: '—'
		},
		{
			id: 'actions',
			enableHiding: false,
			cell: ({ row }) =>
				renderComponent(DataTableRowActions, {
					id: row.original.id,
					label: 'meeting',
					viewHref: `/meetings/${row.original.id}`,
					onEdit: onEdit ? () => onEdit(row.original.id) : undefined,
					onDelete: onDelete ? () => onDelete(row.original.id) : undefined
				})
		}
	];
}

/** @deprecated use createMeetingColumns for wired row actions. */
export const meetingColumns: ColumnDef<MeetingRow>[] = createMeetingColumns();
