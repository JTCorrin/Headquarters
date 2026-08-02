import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import TaskTitleButton from './task-title-button.svelte';

export interface TaskRow {
	id: string;
	title: string;
	relatedTo: string;
	owner: string;
	status: string;
	priority: string;
	dueOn: string;
}

export interface TaskColumnOptions {
	onEdit?: (id: string) => void;
}

export function createTaskColumns(options: TaskColumnOptions = {}): ColumnDef<TaskRow>[] {
	const { onEdit } = options;
	return [
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
			accessorKey: 'title',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Task',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) =>
				renderComponent(TaskTitleButton, {
					title: row.original.title,
					onclick: () => onEdit?.(row.original.id)
				})
		},
		{
			accessorKey: 'priority',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Priority',
					onclick: column.getToggleSortingHandler()
				})
		},
		{
			accessorKey: 'relatedTo',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Related to',
					onclick: column.getToggleSortingHandler()
				})
		},
		{
			accessorKey: 'owner',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Owner',
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
					label: 'task'
				})
		}
	];
}

/** Storybook / static fixtures. */
export const taskColumns = createTaskColumns();
