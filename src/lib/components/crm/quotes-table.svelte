<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { quoteColumns, type QuoteRow } from './quotes-columns.js';

	export type { QuoteRow };

	export interface QuotesTableProps {
		rows: QuoteRow[];
		class?: string;
	}

	let { rows, class: className }: QuotesTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={quoteColumns}
	filterColumn="client"
	filterPlaceholder="Filter quotes…"
	emptyMessage="No quotes yet."
	class={className}
/>
