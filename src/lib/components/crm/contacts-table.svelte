<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { contactStatusFacet } from './data-table-facets.js';
	import { contactColumns, type ContactRow } from './contacts-columns.js';

	export type { ContactRow };

	export interface ContactsTableProps {
		rows: ContactRow[];
		class?: string;
	}

	let { rows, class: className }: ContactsTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={contactColumns}
	filterColumn="name"
	filterPlaceholder="Filter contacts…"
	facets={[contactStatusFacet]}
	emptyMessage="No contacts yet."
	class={className}
/>
