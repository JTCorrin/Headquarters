<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { billColumns, type BillRow } from './bills-columns.js';

	export type { BillRow };

	export interface BillsTableProps {
		rows: BillRow[];
		class?: string;
	}

	let { rows, class: className }: BillsTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={billColumns}
	filterColumn="vendor"
	filterPlaceholder="Filter bills…"
	emptyMessage="No bills yet."
	class={className}
/>
