import type { ColumnDef } from '@tanstack/table-core';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import StatusBadge from './status-badge.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';
import DataTableRowActions from './data-table-row-actions.svelte';
import ProductSkuLink from './product-sku-link.svelte';

export interface ProductRow {
	id: string;
	sku: string;
	name: string;
	category?: string;
	unitPrice: string;
	stock?: number;
	/** When set with stock, highlight rows at or below this qty. */
	lowStockAt?: number;
	status: string;
}

export const productColumns: ColumnDef<ProductRow>[] = [
	{
		accessorKey: 'sku',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'SKU',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) =>
			renderComponent(ProductSkuLink, {
				id: row.original.id,
				sku: row.original.sku
			})
	},
	{
		accessorKey: 'name',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Name',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.getValue('name')
	},
	{
		accessorKey: 'category',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Category',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.original.category ?? '—'
	},
	{
		accessorKey: 'unitPrice',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Unit price',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => row.getValue('unitPrice')
	},
	{
		accessorKey: 'stock',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Stock',
				onclick: column.getToggleSortingHandler()
			}),
		cell: ({ row }) => {
			const stock = row.original.stock;
			if (stock === undefined) return '—';
			const lowAt = row.original.lowStockAt;
			if (lowAt !== undefined && stock <= lowAt) {
				return `${stock} · low`;
			}
			return String(stock);
		},
		sortingFn: (a, b) => (a.original.stock ?? -1) - (b.original.stock ?? -1)
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
		id: 'actions',
		enableHiding: false,
		cell: ({ row }) =>
			renderComponent(DataTableRowActions, {
				id: row.original.id,
				label: 'product'
			})
	}
];
