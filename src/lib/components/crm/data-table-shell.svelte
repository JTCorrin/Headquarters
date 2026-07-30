<script lang="ts" generics="TData, TValue">
	import {
		type ColumnDef,
		type ColumnFiltersState,
		type PaginationState,
		type RowSelectionState,
		type SortingState,
		type VisibilityState,
		getCoreRowModel,
		getFilteredRowModel,
		getPaginationRowModel,
		getSortedRowModel
	} from '@tanstack/table-core';
	import { createSvelteTable, FlexRender } from '$lib/components/ui/data-table/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	export interface DataTableShellProps<TData, TValue> {
		columns: ColumnDef<TData, TValue>[];
		data: TData[];
		filterColumn?: string;
		filterPlaceholder?: string;
		pageSize?: number;
		emptyMessage?: string;
		class?: string;
	}

	let {
		columns,
		data,
		filterColumn,
		filterPlaceholder = 'Filter…',
		pageSize = 8,
		emptyMessage = 'No results.',
		class: className
	}: DataTableShellProps<TData, TValue> = $props();

	let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 8 });
	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);
	let columnVisibility = $state<VisibilityState>({});
	let rowSelection = $state<RowSelectionState>({});

	$effect(() => {
		pagination = { ...pagination, pageSize };
	});

	const table = createSvelteTable({
		get data() {
			return data;
		},
		get columns() {
			return columns;
		},
		getRowId: (row, index) => {
			const id = (row as { id?: string }).id;
			return id ?? String(index);
		},
		enableRowSelection: true,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onPaginationChange: (updater) => {
			pagination = typeof updater === 'function' ? updater(pagination) : updater;
		},
		onSortingChange: (updater) => {
			sorting = typeof updater === 'function' ? updater(sorting) : updater;
		},
		onColumnFiltersChange: (updater) => {
			columnFilters = typeof updater === 'function' ? updater(columnFilters) : updater;
		},
		onColumnVisibilityChange: (updater) => {
			columnVisibility = typeof updater === 'function' ? updater(columnVisibility) : updater;
		},
		onRowSelectionChange: (updater) => {
			rowSelection = typeof updater === 'function' ? updater(rowSelection) : updater;
		},
		state: {
			get pagination() {
				return pagination;
			},
			get sorting() {
				return sorting;
			},
			get columnFilters() {
				return columnFilters;
			},
			get columnVisibility() {
				return columnVisibility;
			},
			get rowSelection() {
				return rowSelection;
			}
		}
	});

	// Touch controlled state so row/header renders re-run after interactions.
	const headerGroups = $derived.by(() => {
		void sorting;
		void columnVisibility;
		return table.getHeaderGroups();
	});
	const rows = $derived.by(() => {
		void sorting;
		void pagination;
		void columnFilters;
		void rowSelection;
		void columnVisibility;
		return table.getRowModel().rows;
	});
	const selectedCount = $derived.by(() => {
		void rowSelection;
		void columnFilters;
		return table.getFilteredSelectedRowModel().rows.length;
	});
	const filteredCount = $derived.by(() => {
		void columnFilters;
		void sorting;
		return table.getFilteredRowModel().rows.length;
	});
	const pageIndex = $derived.by(() => {
		void pagination;
		return table.getState().pagination.pageIndex;
	});
	const pageCount = $derived.by(() => {
		void pagination;
		void columnFilters;
		return Math.max(table.getPageCount(), 1);
	});
	const canPreviousPage = $derived.by(() => {
		void pagination;
		return table.getCanPreviousPage();
	});
	const canNextPage = $derived.by(() => {
		void pagination;
		void columnFilters;
		return table.getCanNextPage();
	});
	const filterValue = $derived.by(() => {
		void columnFilters;
		if (!filterColumn) return '';
		return (table.getColumn(filterColumn)?.getFilterValue() as string) ?? '';
	});
</script>

<div class={cn('space-y-3', className)}>
	<div class="flex flex-wrap items-center gap-2">
		{#if filterColumn}
			<Input
				placeholder={filterPlaceholder}
				value={filterValue}
				oninput={(e) => table.getColumn(filterColumn)?.setFilterValue(e.currentTarget.value)}
				class="max-w-xs"
			/>
		{/if}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" class="ms-auto">
						Columns
						<ChevronDownIcon class="ms-1.5 size-3.5" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				{#each table.getAllColumns().filter((col) => col.getCanHide()) as column (column.id)}
					<DropdownMenu.CheckboxItem
						class="capitalize"
						bind:checked={
							() => column.getIsVisible(), (v) => column.toggleVisibility(!!v)
						}
					>
						{column.id}
					</DropdownMenu.CheckboxItem>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	<div class="overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10">
		<Table.Root>
			<Table.Header>
				{#each headerGroups as headerGroup (headerGroup.id)}
					<Table.Row>
						{#each headerGroup.headers as header (header.id)}
							<Table.Head colspan={header.colSpan}>
								{#if !header.isPlaceholder}
									<FlexRender
										content={header.column.columnDef.header}
										context={header.getContext()}
									/>
								{/if}
							</Table.Head>
						{/each}
					</Table.Row>
				{/each}
			</Table.Header>
			<Table.Body>
				{#each rows as row (row.id)}
					<Table.Row data-state={row.getIsSelected() && 'selected'}>
						{#each row.getVisibleCells() as cell (`${cell.id}:${row.getIsSelected()}`)}
							<Table.Cell>
								<FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
							</Table.Cell>
						{/each}
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={columns.length} class="text-muted-foreground h-24 text-center">
							{emptyMessage}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>

	<div class="text-muted-foreground flex flex-wrap items-center justify-between gap-3 px-1 text-sm">
		<p>
			{selectedCount} of {filteredCount} row(s) selected.
		</p>
		<div class="flex items-center gap-2">
			<span>
				Page {pageIndex + 1} of {pageCount}
			</span>
			<Button
				variant="outline"
				size="sm"
				onclick={() => table.previousPage()}
				disabled={!canPreviousPage}
			>
				Previous
			</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={() => table.nextPage()}
				disabled={!canNextPage}
			>
				Next
			</Button>
		</div>
	</div>
</div>
