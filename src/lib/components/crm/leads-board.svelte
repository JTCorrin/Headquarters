<script lang="ts">
	import SvarKanbanShell from './svar-kanban-shell.svelte';
	import type { KanbanCard, ColumnConfig } from '@svar-ui/svelte-kanban';
	import { cn } from '$lib/utils.js';
	import { leadStages } from '$lib/schemas/lead.js';

	export type LeadStage = (typeof leadStages)[number];

	export interface LeadCard {
		id: string;
		name: string;
		companyName?: string | null;
		valueCents?: number | null;
		currency?: string;
		owner?: string | null;
		stage: LeadStage;
		version?: number;
	}

	export interface LeadsBoardProps {
		leads: LeadCard[];
		stages?: { id: LeadStage; label: string }[];
		class?: string;
		onSelectLead?: (id: string) => void;
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
		onSelectLead
	}: LeadsBoardProps = $props();

	const columns = $derived<ColumnConfig[]>(
		stages.map((stage) => ({
			id: stage.id,
			label: stage.label,
			addCard: false
		}))
	);

	function formatValue(lead: LeadCard): string | null {
		if (lead.valueCents == null) return null;
		const currency = lead.currency ?? 'GBP';
		return `${currency} ${(lead.valueCents / 100).toLocaleString()}`;
	}

	const cards = $derived<KanbanCard[]>(
		leads.map((lead) => ({
			id: lead.id,
			label: lead.name,
			column: lead.stage,
			description: [
				lead.companyName,
				formatValue(lead),
				lead.owner ? `Owner: ${lead.owner}` : null
			]
				.filter(Boolean)
				.join(' · ')
		}))
	);

	/** SVAR encodes string IDs with setID (`:uuid`); map back to the original lead id. */
	function resolveLeadId(encoded: string | null): string | null {
		if (!encoded) return null;
		const match = leads.find(
			(lead) => encoded === `:${lead.id}` || encoded === String(lead.id)
		);
		return match?.id ?? null;
	}

	function selectFromEvent(e: Event) {
		const target = e.target as HTMLElement | null;
		const card = target?.closest?.('[data-id]') as HTMLElement | null;
		if (!card) return;
		const id = resolveLeadId(card.getAttribute('data-id'));
		if (id) onSelectLead?.(id);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const target = e.target as HTMLElement | null;
		if (!target?.closest?.('[data-id]')) return;
		e.preventDefault();
		selectFromEvent(e);
	}
</script>

<!--
  Read-only board: stage changes (including Won) go through edit/convert, not drag.
  Cards are focusable role=button from SVAR; wrapper only resolves setID-encoded data-id.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class={cn(className)} data-testid="leads-board" onclick={selectFromEvent} onkeydown={onKeydown}>
	<SvarKanbanShell {cards} {columns} readonly class="h-full" />
</div>
