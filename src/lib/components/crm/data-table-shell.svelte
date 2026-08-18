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
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import {
		ALL_FACET_VALUE,
		withFacetFilterFns,
		type DataTableFacet
	} from './data-table-facets.js';

	export type { DataTableFacet };

	export interface DataTableShellProps<TData, TValue> {
		columns: ColumnDef<TData, TValue>[];
		data: TData[];
		filterColumn?: string;
		filterPlaceholder?: string;
		facets?: DataTableFacet[];
		pageSize?: number;
		emptyMessage?: string;
		class?: string;
	}

	let {
		columns,
		data,
		filterColumn,
		filterPlaceholder = 'Filter…',
		facets = [],
		pageSize = 8,
		emptyMessage = 'No results.',
		class: className
	}: DataTableShellProps<TData, TValue> = $props();

	const isMobile = new IsMobile();
	const mobileVisibleIds = new Set([
		'select',
		'actions',
		'name',
		'status',
		'title',
		'number',
		'sku'
	]);

	function columnId(column: ColumnDef<TData, TValue>): string | undefined {
		if (column.id) return column.id;
		if ('accessorKey' in column && column.accessorKey != null) {
			return String(column.accessorKey);
		}
		return undefined;
	}

	function visibilityForViewport(mobile: boolean): VisibilityState {
		if (!mobile) return {};
		const vis: VisibilityState = {};
		for (const column of columns) {
			const id = columnId(column);
			if (!id || column.enableHiding === false) continue;
			if (!mobileVisibleIds.has(id)) vis[id] = false;
		}
		return vis;
	}

	let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 8 });
	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);
	let columnVisibility = $state<VisibilityState>(visibilityForViewport(isMobile.current));
	let rowSelection = $state<RowSelectionState>({});

	// Sync pageSize from props without read/write looping on pagination.
	$effect(() => {
		const nextSize = pageSize;
		if (pagination.pageSize !== nextSize) {
			pagination = { pageIndex: pagination.pageIndex, pageSize: nextSize };
		}
	});

	$effect(() => {
		columnVisibility = visibilityForViewport(isMobile.current);
	});

	const hasSelectColumn = $derived(columns.some((column) => column.id === 'select'));
	const tableColumns = $derived(withFacetFilterFns(columns, facets));

	const table = createSvelteTable({
		get data() {
			return data;
		},
		get columns() {
			return tableColumns;
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
		void data;
		void tableColumns;
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

	function facetSelectedValue(column: string): string {
		void columnFilters;
		const raw = table.getColumn(column)?.getFilterValue();
		return typeof raw === 'string' && raw.length > 0 ? raw : ALL_FACET_VALUE;
	}

	function facetTriggerLabel(facet: DataTableFacet): string {
		const selected = facetSelectedValue(facet.column);
		if (selected === ALL_FACET_VALUE) return `All ${facet.label.toLowerCase()}`;
		return facet.options.find((option) => option.value === selected)?.label ?? facet.label;
	}

	function setFacetFilter(column: string, value: string | undefined) {
		const next = !value || value === ALL_FACET_VALUE ? undefined : value;
		table.getColumn(column)?.setFilterValue(next);
		if (pagination.pageIndex !== 0) {
			pagination = { ...pagination, pageIndex: 0 };
		}
	}
</script>

<div class={cn('space-y-3', className)}>
	<div class="flex flex-wrap items-center gap-2">
		{#if filterColumn}
			<Input
				placeholder={filterPlaceholder}
				value={filterValue}
				oninput={(e) => table.getColumn(filterColumn)?.setFilterValue(e.currentTarget.value)}
				class="w-full sm:max-w-xs"
			/>
		{/if}
		{#each facets as facet (facet.column)}
			<Select.Root
				type="single"
				value={facetSelectedValue(facet.column)}
				onValueChange={(value) => setFacetFilter(facet.column, value)}
			>
				<Select.Trigger
					size="sm"
					class="w-[10.5rem]"
					aria-label={facet.label}
					data-testid={`data-table-facet-${facet.column}`}
				>
					{facetTriggerLabel(facet)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value={ALL_FACET_VALUE} label={`All ${facet.label.toLowerCase()}`}>
						All {facet.label.toLowerCase()}
					</Select.Item>
					{#each facet.options as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/each}
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
			{#if hasSelectColumn}
				{selectedCount} of {filteredCount} row(s) selected.
			{:else}
				{filteredCount} row(s)
			{/if}
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
