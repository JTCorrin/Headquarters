<script lang="ts">
	import SvarKanbanShell from './svar-kanban-shell.svelte';
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import { cn } from '$lib/utils.js';

	export type TaskBoardStatus = 'open' | 'in_progress' | 'blocked' | 'done';

	export interface TaskBoardCard {
		id: string;
		title: string;
		relatedTo?: string;
		owner?: string;
		status: TaskBoardStatus;
		dueOn?: string;
	}

	export interface TasksBoardProps {
		tasks: TaskBoardCard[];
		columns?: { id: TaskBoardStatus; label: string }[];
		class?: string;
	}

	const defaultColumns: { id: TaskBoardStatus; label: string }[] = [
		{ id: 'open', label: 'Open' },
		{ id: 'in_progress', label: 'In progress' },
		{ id: 'blocked', label: 'Blocked' },
		{ id: 'done', label: 'Done' }
	];

	let { tasks, columns: stageColumns = defaultColumns, class: className }: TasksBoardProps =
		$props();

	const columns = $derived<ColumnConfig[]>(
		stageColumns.map((col) => ({
			id: col.id,
			label: col.label,
			addCard: false
		}))
	);

	const cards = $derived<KanbanCard[]>(
		tasks.map((task) => ({
			id: task.id,
			label: task.title,
			column: task.status,
			description: [task.relatedTo, task.owner ? `Owner: ${task.owner}` : null, task.dueOn]
				.filter(Boolean)
				.join(' · ')
		}))
	);
</script>

<SvarKanbanShell {cards} {columns} class={cn(className)} />
