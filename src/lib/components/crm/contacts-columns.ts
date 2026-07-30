import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';

export interface ContactRow {
	id: string;
	name: string;
	email: string;
	company?: string;
	status: string;
	owner?: string;
}

export const contactColumns: ColumnDef<ContactRow>[] = [
	{
		id: 'select',
		header: ({ table }) =>
			renderComponent(DataTableCheckbox, {
				checked: table.getIsAllPageRowsSelected(),
				indeterminate: table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(),
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
		accessorKey: 'name',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Name',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.getValue('name')
	},
	{
		accessorKey: 'email',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Email',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.getValue('email')
	},
	{
		accessorKey: 'company',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Company',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.original.company ?? '—'
	},
	{
		accessorKey: 'status',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Status',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(StatusBadge, {
				status: row.original.status
			})
	},
	{
		accessorKey: 'owner',
		header: 'Owner',
		cell: ({ row }) => row.original.owner ?? '—'
	},
	{
		id: 'actions',
		enableHiding: false,
		cell: ({ row }) =>
			renderComponent(DataTableRowActions, {
				id: row.original.id,
				label: 'contact'
			})
	}
];
