<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { recurringInvoiceStatusFacet } from './data-table-facets.js';
	import { recurringInvoiceColumns, type RecurringInvoiceRow } from './recurring-invoices-columns.js';

	export type { RecurringInvoiceRow };

	export interface RecurringInvoicesTableProps {
		rows: RecurringInvoiceRow[];
		class?: string;
	}

	let { rows, class: className }: RecurringInvoicesTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={recurringInvoiceColumns}
	filterColumn="name"
	filterPlaceholder="Filter schedules…"
	facets={[recurringInvoiceStatusFacet]}
	emptyMessage="No recurring schedules yet."
	class={className}
/>
