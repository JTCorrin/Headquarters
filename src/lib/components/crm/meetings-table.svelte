<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { createMeetingColumns, type MeetingRow } from './meetings-columns.js';

	export type { MeetingRow };

	export interface MeetingsTableProps {
		rows: MeetingRow[];
		class?: string;
		onEditMeeting?: (id: string) => void;
		onDeleteMeeting?: (id: string) => void;
	}

	let { rows, class: className, onEditMeeting, onDeleteMeeting }: MeetingsTableProps = $props();

	const columns = $derived(
		createMeetingColumns({ onEdit: onEditMeeting, onDelete: onDeleteMeeting })
	);
</script>

<DataTableShell
	data={rows}
	{columns}
	filterColumn="title"
	filterPlaceholder="Filter meetings…"
	emptyMessage="No meetings yet."
	class={className}
/>
