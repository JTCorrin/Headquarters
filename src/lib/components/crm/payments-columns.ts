import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';

export interface PaymentRow {
	id: string;
	client: string;
	invoiceNumber?: string;
	amount: string;
	method: string;
	status: string;
	receivedOn: string;
}

export const paymentColumns: ColumnDef<PaymentRow>[] = [
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
		accessorKey: 'receivedOn',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Received',
				onclick: column.getToggleSortingHandler()
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
		accessorKey: 'invoiceNumber',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Invoice',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.original.invoiceNumber ?? '—'
	},
	{
		accessorKey: 'amount',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Amount',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'method',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Method',
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
		id: 'actions',
		enableHiding: false,
		cell: ({ row }) =>
			renderComponent(DataTableRowActions, {
				id: row.original.id,
				label: 'payment'
			})
	}
];
