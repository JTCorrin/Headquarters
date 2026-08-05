import type { ColumnDef } from '@tanstack/table-core';
import type { ContactListItem } from '$lib/schemas/contact.js';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import ContactNameLink from './contact-name-link.svelte';

export type ContactRow = ContactListItem;

export const contactColumns: ColumnDef<ContactRow>[] = [
	{
		accessorKey: 'name',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Name',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(ContactNameLink, {
				id: row.original.id,
				name: row.original.name
			})
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
