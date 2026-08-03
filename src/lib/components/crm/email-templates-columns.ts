import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import EmailTemplateNameLink from './email-template-name-link.svelte';

export interface EmailTemplateRow {
	id: string;
	name: string;
	subject: string;
	category: string;
	status: string;
	updatedAt: string;
	/** Optimistic concurrency token for PATCH/DELETE — not shown in the table. */
	version: number;
}

export const emailTemplateColumns: ColumnDef<EmailTemplateRow>[] = [
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
		cell: ({ row }) =>
			renderComponent(EmailTemplateNameLink, {
				id: row.original.id,
				name: row.original.name
			})
	},
	{
		accessorKey: 'subject',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Subject',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'category',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Category',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => renderComponent(StatusBadge, { status: row.original.category })
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
		accessorKey: 'updatedAt',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Updated',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		id: 'actions',
		enableHiding: false,
		cell: ({ row }) =>
			renderComponent(DataTableRowActions, {
				id: row.original.id,
				label: 'template'
			})
	}
];
