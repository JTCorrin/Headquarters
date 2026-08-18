<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { clientStatusFacet } from './data-table-facets.js';
	import { clientColumns, type ClientRow } from './clients-columns.js';

	export type { ClientRow };

	export interface ClientsTableProps {
		rows: ClientRow[];
		class?: string;
	}

	let { rows, class: className }: ClientsTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={clientColumns}
	filterColumn="name"
	filterPlaceholder="Filter clients…"
	facets={[clientStatusFacet]}
	emptyMessage="No clients yet."
	class={className}
/>
