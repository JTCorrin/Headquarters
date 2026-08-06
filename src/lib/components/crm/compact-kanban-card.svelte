<script lang="ts">
	import type { KanbanCard, CardShape } from '@svar-ui/svelte-kanban';

	let { card, cardShape }: { card: KanbanCard; cardShape: CardShape } = $props();
</script>

<div class="compact-kanban-card">
	{#if card.label}
		<p class="compact-kanban-card-title">{card.label}</p>
	{/if}
	{#if card.description && cardShape.description}
		<p class="compact-kanban-card-desc">{card.description}</p>
	{/if}
</div>

<style>
	.compact-kanban-card {
		min-width: 0;
	}

	.compact-kanban-card-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.01em;
	}

	.compact-kanban-card-desc {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		line-height: 1.3;
		color: var(--muted-foreground);
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}
</style>
