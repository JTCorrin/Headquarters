<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { quoteStatusFacet } from './data-table-facets.js';
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
	facets={[quoteStatusFacet]}
	emptyMessage="No quotes yet."
	class={className}
/>
