<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { createTaskColumns, type TaskRow } from './tasks-columns.js';

	export type { TaskRow };

	export interface TasksTableProps {
		rows: TaskRow[];
		onEditTask?: (id: string) => void;
		class?: string;
	}

	let { rows, onEditTask, class: className }: TasksTableProps = $props();

	const columns = $derived(createTaskColumns({ onEdit: onEditTask }));
</script>

<DataTableShell
	data={rows}
	{columns}
	filterColumn="title"
	filterPlaceholder="Filter tasks…"
	emptyMessage="No tasks yet."
	class={className}
/>
