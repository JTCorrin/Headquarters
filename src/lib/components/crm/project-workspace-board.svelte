<script lang="ts">
	import SvarKanbanShell from './svar-kanban-shell.svelte';
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import { cn } from '$lib/utils.js';

	export type ProjectWorkColumn = 'backlog' | 'doing' | 'review' | 'done';

	export interface ProjectWorkCard {
		id: string;
		title: string;
		assignee?: string;
		column: ProjectWorkColumn;
		dueOn?: string;
	}

	export interface ProjectWorkspaceBoardProps {
		cards: ProjectWorkCard[];
		columns?: { id: ProjectWorkColumn; label: string }[];
		class?: string;
	}

	const defaultColumns: { id: ProjectWorkColumn; label: string }[] = [
		{ id: 'backlog', label: 'Backlog' },
		{ id: 'doing', label: 'Doing' },
		{ id: 'review', label: 'Review' },
		{ id: 'done', label: 'Done' }
	];

	let {
		cards: workCards,
		columns: stageColumns = defaultColumns,
		class: className
	}: ProjectWorkspaceBoardProps = $props();

	const columns = $derived<ColumnConfig[]>(
		stageColumns.map((col) => ({
			id: col.id,
			label: col.label,
			addCard: false
		}))
	);

	const cards = $derived<KanbanCard[]>(
		workCards.map((card) => ({
			id: card.id,
			label: card.title,
			column: card.column,
			description: [card.assignee ? `Owner: ${card.assignee}` : null, card.dueOn]
				.filter(Boolean)
				.join(' · ')
		}))
	);
</script>

<SvarKanbanShell {cards} {columns} class={cn(className)} />
