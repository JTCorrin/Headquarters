<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { taskColumns, type TaskRow } from './tasks-columns.js';

	export type { TaskRow };

	export interface TasksTableProps {
		rows: TaskRow[];
		class?: string;
	}

	let { rows, class: className }: TasksTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={taskColumns}
	filterColumn="title"
	filterPlaceholder="Filter tasks…"
	emptyMessage="No tasks yet."
	class={className}
/>
