<script lang="ts">
	import type { KanbanCard, CardShape } from '@svar-ui/svelte-kanban';
	import { Button } from '$lib/components/ui/button/index.js';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { leadBoardCardApi } from './leads-board-card-api.svelte.js';

	let { card, cardShape }: { card: KanbanCard; cardShape: CardShape } = $props();

	const api = $derived(leadBoardCardApi.current);
	const leadId = $derived(api?.resolveLeadId(card.id) ?? null);
	const movable = $derived(!!leadId && !!api?.isMovable(leadId));
	const canUp = $derived(!!leadId && !!api?.canMove(leadId, 'up'));
	const canDown = $derived(!!leadId && !!api?.canMove(leadId, 'down'));
</script>

<div class="lead-board-card" data-testid={leadId ? `lead-card-${leadId}` : undefined}>
	<div class="lead-board-card-main">
		{#if card.label}
			<p class="lead-board-card-title">{card.label}</p>
		{/if}
		{#if card.description && cardShape.description}
			<p class="lead-board-card-desc">{card.description}</p>
		{/if}
	</div>
	{#if movable && leadId}
		<div class="lead-board-card-moves" data-testid={`lead-move-row-${leadId}`}>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-7"
				disabled={!canUp}
				aria-label={`Move ${card.label ?? 'lead'} up`}
				data-testid={`lead-move-up-${leadId}`}
				onclick={(e) => {
					e.stopPropagation();
					api?.onReorder(leadId, 'up');
				}}
			>
				<ChevronUpIcon class="size-3.5" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-7"
				disabled={!canDown}
				aria-label={`Move ${card.label ?? 'lead'} down`}
				data-testid={`lead-move-down-${leadId}`}
				onclick={(e) => {
					e.stopPropagation();
					api?.onReorder(leadId, 'down');
				}}
			>
				<ChevronDownIcon class="size-3.5" />
			</Button>
		</div>
	{/if}
</div>

<style>
	.lead-board-card {
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
		min-width: 0;
	}

	.lead-board-card-main {
		min-width: 0;
		flex: 1 1 auto;
	}

	.lead-board-card-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.01em;
	}

	.lead-board-card-desc {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		line-height: 1.3;
		color: var(--muted-foreground);
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}

	.lead-board-card-moves {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		gap: 0;
		margin: -0.15rem -0.25rem 0 0;
	}
</style>
