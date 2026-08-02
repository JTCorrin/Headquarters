import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import type { PaymentListItem } from '$lib/schemas/payment.js';

export type PaymentRow = PaymentListItem;

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
		accessorKey: 'occurredOn',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Date',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'direction',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Direction',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'party',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Party',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'allocationsSummary',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Allocation',
				onclick: column.getToggleSortingHandler()
			})
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
