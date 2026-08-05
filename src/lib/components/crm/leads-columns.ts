import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import LeadNameLink from './lead-name-link.svelte';
import type { LeadCard } from './leads-board.svelte';

export interface LeadRow {
	id: string;
	name: string;
	company: string;
	stage: string;
	value: string;
	valueCents: number;
}

function stageLabel(stage: string): string {
	return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function leadCardToRow(lead: LeadCard): LeadRow {
	const value =
		lead.valueCents == null
			? '—'
			: `${lead.currency ?? 'GBP'} ${(lead.valueCents / 100).toLocaleString()}`;
	return {
		id: lead.id,
		name: lead.name,
		company: lead.companyName?.trim() || '—',
		stage: stageLabel(lead.stage),
		value,
		valueCents: lead.valueCents ?? -1
	};
}

export const leadColumns: ColumnDef<LeadRow>[] = [
	{
		accessorKey: 'name',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Name',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(LeadNameLink, {
				id: row.original.id,
				name: row.original.name
			})
	},
	{
		accessorKey: 'company',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Company',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.original.company
	},
	{
		accessorKey: 'stage',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Stage',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(StatusBadge, {
				status: row.original.stage
			})
	},
	{
		accessorKey: 'value',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Value',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.original.value,
		sortingFn: (a, b) => a.original.valueCents - b.original.valueCents
	}
];
