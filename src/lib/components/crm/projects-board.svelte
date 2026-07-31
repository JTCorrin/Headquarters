<script lang="ts">
	import SvarKanbanShell from './svar-kanban-shell.svelte';
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import { cn } from '$lib/utils.js';

	export type ProjectStage = 'planning' | 'active' | 'blocked' | 'done';

	export interface ProjectCard {
		id: string;
		name: string;
		clientId: string;
		clientName: string;
		owner?: string;
		cardCount?: number;
		stage: ProjectStage;
	}

	export interface ProjectsBoardProps {
		projects: ProjectCard[];
		stages?: { id: ProjectStage; label: string }[];
		class?: string;
	}

	const defaultStages: { id: ProjectStage; label: string }[] = [
		{ id: 'planning', label: 'Planning' },
		{ id: 'active', label: 'Active' },
		{ id: 'blocked', label: 'Blocked' },
		{ id: 'done', label: 'Done' }
	];

	let { projects, stages = defaultStages, class: className }: ProjectsBoardProps = $props();

	const columns = $derived<ColumnConfig[]>(
		stages.map((stage) => ({
			id: stage.id,
			label: stage.label,
			addCard: false
		}))
	);

	const cards = $derived<KanbanCard[]>(
		projects.map((project) => ({
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
</script>

<SvarKanbanShell {cards} {columns} class={cn(className)} />
