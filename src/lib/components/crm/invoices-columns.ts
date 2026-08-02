import type { ColumnDef } from '@tanstack/table-core';
import type { InvoiceListItem } from '$lib/schemas/invoice.js';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import InvoiceNumberLink from './invoice-number-link.svelte';

export type InvoiceRow = InvoiceListItem;

export const invoiceColumns: ColumnDef<InvoiceRow>[] = [
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
		accessorKey: 'number',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Number',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(InvoiceNumberLink, {
				id: row.original.id,
				number: row.original.number
			})
	},
	{
		accessorKey: 'client',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Client',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'total',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Total',
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
		accessorKey: 'dueOn',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Due',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		id: 'actions',
		enableHiding: false,
		cell: ({ row }) =>
			renderComponent(DataTableRowActions, {
				id: row.original.id,
				label: 'invoice'
			})
	}
];
