<script lang="ts">
	import SvarKanbanShell from './svar-kanban-shell.svelte';
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import { cn } from '$lib/utils.js';

	export type LeadStage = 'new' | 'qualified' | 'proposal' | 'won' | 'lost';

	export interface LeadCard {
		id: string;
		name: string;
		company?: string;
		value: string;
		owner?: string;
		stage: LeadStage;
	}

	export interface LeadsBoardProps {
		leads: LeadCard[];
		stages?: { id: LeadStage; label: string }[];
		class?: string;
	}

	const defaultStages: { id: LeadStage; label: string }[] = [
		{ id: 'new', label: 'New' },
		{ id: 'qualified', label: 'Qualified' },
		{ id: 'proposal', label: 'Proposal' },
		{ id: 'won', label: 'Won' },
		{ id: 'lost', label: 'Lost' }
	];

	let { leads, stages = defaultStages, class: className }: LeadsBoardProps = $props();

	const columns = $derived<ColumnConfig[]>(
		stages.map((stage) => ({
			id: stage.id,
			label: stage.label,
			addCard: false
		}))
	);

	const cards = $derived<KanbanCard[]>(
		leads.map((lead) => ({
			id: lead.id,
			label: lead.name,
			column: lead.stage,
			description: [lead.company, lead.value, lead.owner ? `Owner: ${lead.owner}` : null]
				.filter(Boolean)
				.join(' · ')
		}))
	);
</script>

<SvarKanbanShell {cards} {columns} class={cn(className)} />
