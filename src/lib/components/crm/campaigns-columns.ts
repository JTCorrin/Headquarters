import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import CampaignNameLink from './campaign-name-link.svelte';

export interface CampaignRow {
	id: string;
	name: string;
	status: string;
	recipientsTotal: number;
	recipientsSent: number;
	scheduledAt: string | null;
	updatedAt: string;
	version: number;
}

export const campaignColumns: ColumnDef<CampaignRow>[] = [
	{
		accessorKey: 'name',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Name',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(CampaignNameLink, {
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
		id: 'recipients',
		header: 'Recipients',
		cell: ({ row }) => `${row.original.recipientsSent} / ${row.original.recipientsTotal}`
	},
	{
		accessorKey: 'scheduledAt',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Scheduled',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.original.scheduledAt ?? '—'
	},
	{
		accessorKey: 'updatedAt',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Updated',
				onclick: column.getToggleSortingHandler()
			})
	}
];
