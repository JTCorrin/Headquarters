import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import DataTableSortHeader from './data-table-sort-header.svelte';
import type { AuditLogListItem } from '$lib/schemas/audit-event.js';

export type AuditLogRow = AuditLogListItem;

export const auditLogColumns: ColumnDef<AuditLogRow>[] = [
	{
		accessorKey: 'occurredAt',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Timestamp',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'actor',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Actor',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'event',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Event',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'target',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Target',
				onclick: column.getToggleSortingHandler()
			})
	},
	{
		accessorKey: 'ip',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'IP',
				onclick: column.getToggleSortingHandler()
			})
	}
];
