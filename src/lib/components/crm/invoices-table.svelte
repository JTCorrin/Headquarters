<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { invoiceColumns, type InvoiceRow } from './invoices-columns.js';

	export type { InvoiceRow };

	export interface InvoicesTableProps {
		rows: InvoiceRow[];
		class?: string;
	}

	let { rows, class: className }: InvoicesTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={invoiceColumns}
	filterColumn="client"
	filterPlaceholder="Filter invoices…"
	emptyMessage="No invoices yet."
	class={className}
/>
