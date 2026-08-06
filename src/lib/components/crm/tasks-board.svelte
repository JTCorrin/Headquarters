<script lang="ts">
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import SvarKanbanShell, { type MoveCardEvent } from './svar-kanban-shell.svelte';
	import CompactKanbanCard from './compact-kanban-card.svelte';
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

	export interface TaskBoardMove {
		id: string;
		status: TaskBoardStatus;
	}

	export interface TasksBoardProps {
		tasks: TaskBoardCard[];
		columns?: { id: TaskBoardStatus; label: string }[];
		class?: string;
		onSelectTask?: (id: string) => void;
		onMoveTask?: (move: TaskBoardMove) => void | Promise<void>;
	}

	const defaultColumns: { id: TaskBoardStatus; label: string }[] = [
		{ id: 'open', label: 'Open' },
		{ id: 'in_progress', label: 'In progress' },
		{ id: 'blocked', label: 'Blocked' },
		{ id: 'done', label: 'Done' }
	];

	const boardStatuses = defaultColumns.map((c) => c.id) as readonly TaskBoardStatus[];

	let {
		tasks,
		columns: stageColumns = defaultColumns,
		class: className,
		onSelectTask,
		onMoveTask
	}: TasksBoardProps = $props();

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

	function resolveTaskId(encoded: string | number | null | undefined): string | null {
		if (encoded == null) return null;
		const raw = String(encoded);
		const match = tasks.find((task) => raw === `:${task.id}` || raw === String(task.id));
		return match?.id ?? null;
	}

	function selectFromEvent(e: Event) {
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('.wx-expand, .wx-toggle, .wx-add, button')) return;
		const card = target?.closest?.('[data-id]') as HTMLElement | null;
		if (!card) return;
		const id = resolveTaskId(card.getAttribute('data-id'));
		if (id) onSelectTask?.(id);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('button, select, input, textarea, a, .wx-expand, .wx-toggle')) return;
		if (!target?.closest?.('[data-id]')) return;
		e.preventDefault();
		selectFromEvent(e);
	}

	function handleMoveCard(event: MoveCardEvent) {
		const id = resolveTaskId(event.id);
		if (!id) return;
		const status = String(event.column ?? '') as TaskBoardStatus;
		if (!(boardStatuses as readonly string[]).includes(status)) return;
		void onMoveTask?.({ id, status });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={cn(className)}
	data-testid="tasks-board"
	onclick={selectFromEvent}
	onkeydown={onKeydown}
>
	<SvarKanbanShell
		{cards}
		{columns}
		cardContent={CompactKanbanCard}
		onMoveCard={handleMoveCard}
	/>
</div>
