<script lang="ts">
	import StatusBadge from './status-badge.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

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
		cardActions?: Snippet<[LeadCard]>;
	}

	const defaultStages: { id: LeadStage; label: string }[] = [
		{ id: 'new', label: 'New' },
		{ id: 'qualified', label: 'Qualified' },
		{ id: 'proposal', label: 'Proposal' },
		{ id: 'won', label: 'Won' },
		{ id: 'lost', label: 'Lost' }
	];

	let {
		leads,
		stages = defaultStages,
		class: className,
		cardActions
	}: LeadsBoardProps = $props();

	const grouped = $derived(
		stages.map((stage) => ({
			...stage,
			items: leads.filter((lead) => lead.stage === stage.id)
		}))
	);
</script>

<div
	class={cn(
		'grid gap-4 overflow-x-auto pb-2 md:grid-cols-3 xl:grid-cols-5',
		className
	)}
>
	{#each grouped as column (column.id)}
		<section class="bg-muted/30 min-w-[240px] rounded-3xl p-3 ring-1 ring-foreground/5 dark:ring-foreground/10">
			<header class="mb-3 flex items-center justify-between gap-2 px-1">
				<div class="flex items-center gap-2">
					<h3 class="text-sm font-semibold tracking-tight">{column.label}</h3>
					<span class="text-muted-foreground text-xs">{column.items.length}</span>
				</div>
			</header>
			<ul class="m-0 flex list-none flex-col gap-2 p-0">
				{#each column.items as lead (lead.id)}
					<li
						class="bg-card hover:ring-foreground/15 rounded-2xl p-3 shadow-sm ring-1 ring-foreground/5 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md dark:ring-foreground/10"
					>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0 space-y-1">
								<p class="truncate text-sm font-semibold">{lead.name}</p>
								{#if lead.company}
									<p class="text-muted-foreground truncate text-xs">{lead.company}</p>
								{/if}
							</div>
							<StatusBadge status={column.label} />
						</div>
						<div class="text-muted-foreground mt-3 flex items-center justify-between gap-2 text-xs">
							<span class="text-foreground font-medium tabular-nums">{lead.value}</span>
							<span>{lead.owner ?? 'Unassigned'}</span>
						</div>
						{#if cardActions}
							<div class="mt-3">
								{@render cardActions(lead)}
							</div>
						{/if}
					</li>
				{:else}
					<li
						class="text-muted-foreground rounded-2xl border border-dashed px-3 py-8 text-center text-xs"
					>
						No leads
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>
