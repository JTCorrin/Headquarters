<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { meetingColumns, type MeetingRow } from './meetings-columns.js';

	export type { MeetingRow };

	export interface MeetingsTableProps {
		rows: MeetingRow[];
		class?: string;
	}

	let { rows, class: className }: MeetingsTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={meetingColumns}
	filterColumn="title"
	filterPlaceholder="Filter meetings…"
	emptyMessage="No meetings yet."
	class={className}
/>
