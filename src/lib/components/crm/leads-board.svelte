<script lang="ts">
	import type { KanbanCard, ColumnConfig, KanbanInstanceApi } from '@svar-ui/svelte-kanban';
	import SvarKanbanShell, { type MoveCardEvent } from './svar-kanban-shell.svelte';
	import LeadsBoardCard from './leads-board-card.svelte';
	import { leadBoardCardApi } from './leads-board-card-api.svelte.js';
	import { cn } from '$lib/utils.js';
	import { computeBoardPosition } from '$lib/money.js';
	import { buildReorderMove } from '$lib/lead-board-moves.js';
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
		position?: number;
		clientId?: string | null;
	}

	export interface LeadBoardMove {
		id: string;
		stage: LeadStage;
		position: number;
		beforeId: string | null;
	}

	export interface LeadsBoardProps {
		leads: LeadCard[];
		stages?: { id: LeadStage; label: string }[];
		class?: string;
		onSelectLead?: (id: string) => void;
		/** Fired after drag/drop or card move controls. */
		onMoveLead?: (move: LeadBoardMove) => void | Promise<void>;
		/** When a move into Won is attempted (convert-only). */
		onMoveBlocked?: (message: string) => void;
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
		onSelectLead,
		onMoveLead,
		onMoveBlocked
	}: LeadsBoardProps = $props();

	let remountKey = $state(0);

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
		leads
			.slice()
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
			.map((lead) => ({
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
	function resolveLeadId(encoded: string | number | null | undefined): string | null {
		if (encoded == null) return null;
		const raw = String(encoded);
		const match = leads.find((lead) => raw === `:${lead.id}` || raw === String(lead.id));
		return match?.id ?? null;
	}

	function selectFromEvent(e: Event) {
		const target = e.target as HTMLElement | null;
		// Column collapse/expand controls must not be treated as card selection.
		if (target?.closest?.('.wx-expand, .wx-toggle, .wx-add, button')) return;
		const card = target?.closest?.('[data-id]') as HTMLElement | null;
		if (!card) return;
		const id = resolveLeadId(card.getAttribute('data-id'));
		if (id) onSelectLead?.(id);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('button, select, input, textarea, a, .wx-expand, .wx-toggle')) return;
		if (!target?.closest?.('[data-id]')) return;
		e.preventDefault();
		selectFromEvent(e);
	}

	function emitMove(move: LeadBoardMove) {
		void onMoveLead?.(move);
	}

	function handleInit(api: KanbanInstanceApi) {
		api.intercept('move-card', (ev) => {
			const move = ev as MoveCardEvent;
			const stage = String(move.column ?? '');
			if (stage === 'won') {
				onMoveBlocked?.('Won is convert-only — use Convert lead on the detail page.');
				remountKey += 1;
				return false;
			}
			const moving = resolveLeadId(move.id);
			const current = moving ? leads.find((l) => l.id === moving) : null;
			if (current?.stage === 'won') {
				onMoveBlocked?.('Converted (won) leads stay in Won — edit the client instead.');
				remountKey += 1;
				return false;
			}
		});
	}

	function handleMoveCard(event: MoveCardEvent) {
		const id = resolveLeadId(event.id);
		if (!id) return;
		const stage = String(event.column ?? '') as LeadStage;
		if (!(leadStages as readonly string[]).includes(stage) || stage === 'won') {
			remountKey += 1;
			return;
		}
		const beforeId = resolveLeadId(event.before ?? null);
		const columnLeads = leads.filter((l) => l.stage === stage || l.id === id);
		const optimisticColumn = columnLeads.map((l) =>
			l.id === id ? { ...l, stage } : l
		);
		const position = computeBoardPosition(optimisticColumn, beforeId, id);
		emitMove({ id, stage, position, beforeId });
	}

	function onCardReorder(leadId: string, direction: 'up' | 'down') {
		const move = buildReorderMove(leads, leadId, direction);
		if (!move) return;
		emitMove(move);
	}

	function canMove(leadId: string, direction: 'up' | 'down'): boolean {
		return buildReorderMove(leads, leadId, direction) != null;
	}

	$effect(() => {
		leadBoardCardApi.current = {
			resolveLeadId,
			canMove,
			onReorder: onCardReorder,
			isMovable: (leadId) => leads.some((l) => l.id === leadId && l.stage !== 'won')
		};
		return () => {
			if (leadBoardCardApi.current?.onReorder === onCardReorder) {
				leadBoardCardApi.current = null;
			}
		};
	});
</script>

<!--
  Interactive board: pointer drag + Move up/down on each card.
  Won blocked (convert-only). remountKey resets SVAR after blocked pointer moves.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class={cn(className)} data-testid="leads-board" onclick={selectFromEvent} onkeydown={onKeydown}>
	{#key remountKey}
		<SvarKanbanShell
			{cards}
			{columns}
			cardContent={LeadsBoardCard}
			readonly={false}
			class="h-full min-h-[420px]"
			onInit={handleInit}
			onMoveCard={handleMoveCard}
		/>
	{/key}
</div>
