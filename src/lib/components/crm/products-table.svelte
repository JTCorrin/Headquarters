<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { productColumns, type ProductRow } from './products-columns.js';

	export type { ProductRow };

	export interface ProductsTableProps {
		rows: ProductRow[];
		class?: string;
	}

	let { rows, class: className }: ProductsTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={productColumns}
	filterColumn="name"
	filterPlaceholder="Filter products…"
	emptyMessage="No products yet."
	class={className}
/>
