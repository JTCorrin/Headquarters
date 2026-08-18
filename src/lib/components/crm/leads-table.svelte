<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { leadStageFacet } from './data-table-facets.js';
	import { leadColumns, type LeadRow } from './leads-columns.js';

	export type { LeadRow };

	export interface LeadsTableProps {
		rows: LeadRow[];
		class?: string;
	}

	let { rows, class: className }: LeadsTableProps = $props();
</script>

<div data-testid="leads-table" class={className}>
	<DataTableShell
		data={rows}
		columns={leadColumns}
		filterColumn="name"
		filterPlaceholder="Filter leads…"
		facets={[leadStageFacet]}
		emptyMessage="No leads yet."
	/>
</div>
