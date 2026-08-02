<script lang="ts">
	import type { KanbanCard, ColumnConfig, KanbanInstanceApi } from '@svar-ui/svelte-kanban';
	import SvarKanbanShell, { type MoveCardEvent } from './svar-kanban-shell.svelte';
	import { cn } from '$lib/utils.js';
	import { computeBoardPosition } from '$lib/money.js';
	import { buildReorderMove, buildStageMove } from '$lib/lead-board-moves.js';
	import { leadStages, leadWritableStages } from '$lib/schemas/lead.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

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
		/** Fired after drag/drop or keyboard move controls. */
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

	const writableStageOptions = [
		{ value: 'new', label: 'New' },
		{ value: 'qualified', label: 'Qualified' },
		{ value: 'proposal', label: 'Proposal' },
		{ value: 'lost', label: 'Lost' }
	] as const;

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

	const movableLeads = $derived(
		leads
			.filter((lead) => lead.stage !== 'won')
			.slice()
			.sort((a, b) => {
				const stageCmp = a.stage.localeCompare(b.stage);
				if (stageCmp !== 0) return stageCmp;
				return (a.position ?? 0) - (b.position ?? 0);
			})
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
		if (target?.closest?.('[data-testid="leads-board-keyboard-moves"]')) return;
		const card = target?.closest?.('[data-id]') as HTMLElement | null;
		if (!card) return;
		const id = resolveLeadId(card.getAttribute('data-id'));
		if (id) onSelectLead?.(id);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('[data-testid="leads-board-keyboard-moves"]')) return;
		if (target?.closest?.('button, select, input, textarea, a')) return;
		if (!target?.closest?.('[data-id]')) return;
		e.preventDefault();
		selectFromEvent(e);
	}

	function emitMove(move: LeadBoardMove) {
		void onMoveLead?.(move);
	}

	function handleInit(api: KanbanInstanceApi) {
		api.intercept('move-card', (ev) => {
			const stage = String(ev.column ?? '');
			if (stage === 'won') {
				onMoveBlocked?.('Won is convert-only — use Convert lead on the detail page.');
				remountKey += 1;
				return false;
			}
			const moving = resolveLeadId(ev.id);
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

	function onKeyboardStageChange(leadId: string, stage: string) {
		if (!(leadWritableStages as readonly string[]).includes(stage)) {
			onMoveBlocked?.('Won is convert-only — use Convert lead on the detail page.');
			return;
		}
		const move = buildStageMove(leads, leadId, stage as LeadStage);
		if (!move) return;
		emitMove(move);
	}

	function onKeyboardReorder(leadId: string, direction: 'up' | 'down') {
		const move = buildReorderMove(leads, leadId, direction);
		if (!move) return;
		emitMove(move);
	}

	function canMove(leadId: string, direction: 'up' | 'down'): boolean {
		return buildReorderMove(leads, leadId, direction) != null;
	}

	function stageLabel(stage: string): string {
		return writableStageOptions.find((o) => o.value === stage)?.label ?? stage;
	}
</script>

<!--
  Interactive board: pointer drag + explicit keyboard move controls.
  Won blocked (convert-only). remountKey resets SVAR after blocked pointer moves.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class={cn('space-y-4', className)} data-testid="leads-board" onclick={selectFromEvent} onkeydown={onKeydown}>
	{#key remountKey}
		<SvarKanbanShell
			{cards}
			{columns}
			readonly={false}
			class="h-full min-h-[420px]"
			onInit={handleInit}
			onMoveCard={handleMoveCard}
		/>
	{/key}

	<section
		class="bg-muted/40 space-y-3 rounded-3xl p-4 ring-1 ring-foreground/5"
		data-testid="leads-board-keyboard-moves"
		aria-label="Keyboard lead moves"
	>
		<div>
			<h3 class="text-sm font-semibold tracking-tight">Keyboard moves</h3>
			<p class="text-muted-foreground text-xs">
				Change stage or reorder within a stage. Won is convert-only.
			</p>
		</div>

		{#if movableLeads.length === 0}
			<p class="text-muted-foreground text-sm">No movable leads on the board.</p>
		{:else}
			<ul class="space-y-3">
				{#each movableLeads as lead (lead.id)}
					<li
						class="bg-card flex flex-col gap-3 rounded-2xl p-3 ring-1 ring-foreground/5 sm:flex-row sm:items-end sm:justify-between"
						data-testid={`lead-move-row-${lead.id}`}
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{lead.name}</p>
							<p class="text-muted-foreground text-xs capitalize">{lead.stage}</p>
						</div>
						<div class="flex flex-wrap items-end gap-2">
							<div class="space-y-1">
								<Label for={`lead-stage-${lead.id}`} class="text-xs">Stage</Label>
								<Select.Root
									type="single"
									value={lead.stage === 'won' ? 'proposal' : lead.stage}
									onValueChange={(value) => {
										if (value) onKeyboardStageChange(lead.id, value);
									}}
								>
									<Select.Trigger
										id={`lead-stage-${lead.id}`}
										class="w-[9.5rem]"
										aria-label={`Stage for ${lead.name}`}
										data-testid={`lead-stage-${lead.id}`}
									>
										{stageLabel(lead.stage)}
									</Select.Trigger>
									<Select.Content>
										{#each writableStageOptions as option (option.value)}
											<Select.Item value={option.value} label={option.label}>
												{option.label}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!canMove(lead.id, 'up')}
								aria-label={`Move ${lead.name} up in ${lead.stage}`}
								data-testid={`lead-move-up-${lead.id}`}
								onclick={() => onKeyboardReorder(lead.id, 'up')}
							>
								Move up
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!canMove(lead.id, 'down')}
								aria-label={`Move ${lead.name} down in ${lead.stage}`}
								data-testid={`lead-move-down-${lead.id}`}
								onclick={() => onKeyboardReorder(lead.id, 'down')}
							>
								Move down
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
