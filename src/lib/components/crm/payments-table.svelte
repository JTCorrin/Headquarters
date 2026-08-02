<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { paymentColumns, type PaymentRow } from './payments-columns.js';

	export type { PaymentRow };

	export interface PaymentsTableProps {
		rows: PaymentRow[];
		class?: string;
	}

	let { rows, class: className }: PaymentsTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={paymentColumns}
	filterColumn="party"
	filterPlaceholder="Filter payments…"
	emptyMessage="No payments yet."
	class={className}
/>
