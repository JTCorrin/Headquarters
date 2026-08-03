<script lang="ts">
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import SvarKanbanShell, { type MoveCardEvent } from './svar-kanban-shell.svelte';
	import { cn } from '$lib/utils.js';
	import { computeBoardPosition } from '$lib/money.js';
	import { projectBoardStatuses, type ProjectBoardStatus } from '$lib/schemas/project.js';

	export type ProjectStage = ProjectBoardStatus;

	export interface ProjectCard {
		id: string;
		name: string;
		clientId: string;
		clientName: string;
		owner?: string;
		cardCount?: number;
		stage: ProjectStage;
		version?: number;
		position?: number;
	}

	export interface ProjectBoardMove {
		id: string;
		status: ProjectStage;
		position: number;
		beforeId: string | null;
	}

	export interface ProjectsBoardProps {
		projects: ProjectCard[];
		stages?: { id: ProjectStage; label: string }[];
		class?: string;
		onSelectProject?: (id: string) => void;
		onMoveProject?: (move: ProjectBoardMove) => void | Promise<void>;
	}

	const defaultStages: { id: ProjectStage; label: string }[] = [
		{ id: 'planning', label: 'Planning' },
		{ id: 'active', label: 'Active' },
		{ id: 'blocked', label: 'Blocked' },
		{ id: 'done', label: 'Done' }
	];

	let {
		projects,
		stages = defaultStages,
		class: className,
		onSelectProject,
		onMoveProject
	}: ProjectsBoardProps = $props();

	const columns = $derived<ColumnConfig[]>(
		stages.map((stage) => ({
			id: stage.id,
			label: stage.label,
			addCard: false
		}))
	);

	const cards = $derived<KanbanCard[]>(
		projects
			.slice()
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
			.map((project) => ({
				id: project.id,
				label: project.name,
				column: project.stage,
				description: [
					project.clientName,
					project.owner ? `Owner: ${project.owner}` : null,
					project.cardCount !== undefined ? `${project.cardCount} cards` : null
				]
					.filter(Boolean)
					.join(' · ')
			}))
	);

	function resolveProjectId(encoded: string | number | null | undefined): string | null {
		if (encoded == null) return null;
		const raw = String(encoded);
		const match = projects.find((p) => raw === `:${p.id}` || raw === String(p.id));
		return match?.id ?? null;
	}

	function selectFromEvent(e: Event) {
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('.wx-expand, .wx-toggle, .wx-add, button')) return;
		const card = target?.closest?.('[data-id]') as HTMLElement | null;
		if (!card) return;
		const id = resolveProjectId(card.getAttribute('data-id'));
		if (id) onSelectProject?.(id);
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
		const id = resolveProjectId(event.id);
		if (!id) return;
		const status = String(event.column ?? '') as ProjectStage;
		if (!(projectBoardStatuses as readonly string[]).includes(status)) return;
		const beforeId = resolveProjectId(event.before ?? null);
		const columnProjects = projects.filter((p) => p.stage === status || p.id === id);
		const optimisticColumn = columnProjects.map((p) =>
			p.id === id ? { ...p, stage: status } : p
		);
		const position = computeBoardPosition(optimisticColumn, beforeId, id);
		void onMoveProject?.({ id, status, position, beforeId });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={cn(className)}
	data-testid="projects-board"
	onclick={selectFromEvent}
	onkeydown={onKeydown}
>
	<SvarKanbanShell {cards} {columns} onMoveCard={handleMoveCard} />
</div>
