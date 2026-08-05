import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import ClientNameLink from './client-name-link.svelte';

export interface ClientRow {
	id: string;
	name: string;
	status: string;
	owner?: string;
	openInvoices: string;
	pipeline: string;
}

export const clientColumns: ColumnDef<ClientRow>[] = [
	{
		accessorKey: 'name',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Client',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(ClientNameLink, {
				id: row.original.id,
				name: row.original.name
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
		accessorKey: 'owner',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Owner',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.original.owner ?? '—'
	},
	{
		accessorKey: 'openInvoices',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Open invoices',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'pipeline',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Pipeline',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		id: 'actions',
		enableHiding: false,
		cell: ({ row }) =>
			renderComponent(DataTableRowActions, {
				id: row.original.id,
				label: 'client'
			})
	}
];
