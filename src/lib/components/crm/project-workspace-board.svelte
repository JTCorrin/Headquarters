<script lang="ts">
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import SvarKanbanShell, { type MoveCardEvent } from './svar-kanban-shell.svelte';
	import { cn } from '$lib/utils.js';
	import { computeBoardPosition } from '$lib/money.js';

	export interface ProjectWorkCard {
		id: string;
		title: string;
		assignee?: string;
		/** Target column id (project_columns.id). */
		column: string;
		dueOn?: string;
		version?: number;
		position?: number;
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
		onMoveCard
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
				description: [card.assignee ? `Owner: ${card.assignee}` : null, card.dueOn]
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
</script>

<div class={cn(className)} data-testid="project-workspace-board">
	<SvarKanbanShell {cards} {columns} onMoveCard={handleMoveCard} />
</div>
