import type { ColumnDef } from '@tanstack/table-core';
import type { RecurringInvoiceListItem } from '$lib/schemas/recurring-invoice.js';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import RecurringInvoiceNameLink from './recurring-invoice-name-link.svelte';

export type RecurringInvoiceRow = RecurringInvoiceListItem;

export const recurringInvoiceColumns: ColumnDef<RecurringInvoiceRow>[] = [
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
			renderComponent(RecurringInvoiceNameLink, {
				id: row.original.id,
				name: row.original.name
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
		accessorKey: 'frequency',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Frequency',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'nextRunAt',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Next run',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'deliveryMode',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Delivery',
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
	}
];
