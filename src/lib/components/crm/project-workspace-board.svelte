<script lang="ts">
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import SvarKanbanShell, { type MoveCardEvent } from './svar-kanban-shell.svelte';
	import CompactKanbanCard from './compact-kanban-card.svelte';
	import { cn } from '$lib/utils.js';
	import { computeBoardPosition } from '$lib/money.js';

	export interface ProjectWorkCard {
		id: string;
		title: string;
		description?: string;
		assignee?: string;
		/** Target column id (project_columns.id). */
		column: string;
		dueOn?: string;
		version?: number;
		position?: number;
	}

	export interface ProjectWorkColumn {
		id: string;
		label: string;
	}

	export interface ProjectCardBoardMove {
		id: string;
		columnId: string;
		position: number;
		beforeId: string | null;
	}

	export interface ProjectWorkspaceBoardProps {
		cards: ProjectWorkCard[];
		columns?: { id: string; label: string }[];
		class?: string;
		onMoveCard?: (move: ProjectCardBoardMove) => void | Promise<void>;
		onSelectCard?: (id: string) => void;
	}

	const defaultColumns: { id: string; label: string }[] = [
		{ id: 'backlog', label: 'Backlog' },
		{ id: 'doing', label: 'Doing' },
		{ id: 'review', label: 'Review' },
		{ id: 'done', label: 'Done' }
	];

	let {
		cards: workCards,
		columns: stageColumns = defaultColumns,
		class: className,
		onMoveCard,
		onSelectCard
	}: ProjectWorkspaceBoardProps = $props();

	const columns = $derived<ColumnConfig[]>(
		stageColumns.map((col) => ({
			id: col.id,
			label: col.label,
			addCard: false
		}))
	);

	const cards = $derived<KanbanCard[]>(
		workCards
			.slice()
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
			.map((card) => ({
				id: card.id,
				label: card.title,
				column: card.column,
				description: [
					card.description,
					card.assignee ? `Owner: ${card.assignee}` : null,
					card.dueOn
				]
					.filter(Boolean)
					.join(' · ')
			}))
	);

	function resolveCardId(encoded: string | number | null | undefined): string | null {
		if (encoded == null) return null;
		const raw = String(encoded);
		const match = workCards.find((c) => raw === `:${c.id}` || raw === String(c.id));
		return match?.id ?? null;
	}

	function resolveColumnId(encoded: string | number | null | undefined): string | null {
		if (encoded == null) return null;
		const raw = String(encoded);
		const match = stageColumns.find((c) => raw === `:${c.id}` || raw === String(c.id));
		return match?.id ?? null;
	}

	function handleMoveCard(event: MoveCardEvent) {
		const id = resolveCardId(event.id);
		if (!id) return;
		const columnId = resolveColumnId(event.column) ?? String(event.column ?? '');
		if (!columnId || !stageColumns.some((c) => c.id === columnId)) return;
		const beforeId = resolveCardId(event.before ?? null);
		const columnCards = workCards.filter((c) => c.column === columnId || c.id === id);
		const optimisticColumn = columnCards.map((c) =>
			c.id === id ? { ...c, column: columnId } : c
		);
		const position = computeBoardPosition(optimisticColumn, beforeId, id);
		void onMoveCard?.({ id, columnId, position, beforeId });
	}

	function selectFromEvent(e: Event) {
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('.wx-expand, .wx-toggle, .wx-add, button')) return;
		const card = target?.closest?.('[data-id]') as HTMLElement | null;
		if (!card) return;
		const id = resolveCardId(card.getAttribute('data-id'));
		if (id) onSelectCard?.(id);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('button, select, input, textarea, a, .wx-expand, .wx-toggle')) return;
		if (!target?.closest?.('[data-id]')) return;
		e.preventDefault();
		selectFromEvent(e);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={cn(className)}
	data-testid="project-workspace-board"
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
