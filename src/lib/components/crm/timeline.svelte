<script lang="ts">
	import { cn } from '$lib/utils.js';
	import TimelineEventCard from './timeline-event-card.svelte';
	import type { TimelineEventKind } from './timeline-kinds.js';
	import type { Snippet } from 'svelte';

	export interface TimelineEvent {
		id: string;
		kind: TimelineEventKind | string;
		title: string;
		body?: string;
		occurredAt: string;
		actor?: string;
	}

	export interface TimelineProps {
		events: TimelineEvent[];
		title?: string;
		emptyMessage?: string;
		class?: string;
		headerActions?: Snippet;
	}

	let {
		events,
		title = 'Timeline',
		emptyMessage = 'No activity yet.',
		class: className,
		headerActions
	}: TimelineProps = $props();
</script>

<section class={cn('bg-background flex min-h-0 flex-col', className)} aria-label={title}>
	<div class="mb-3 flex items-center justify-between gap-3">
		<h2 class="text-sm font-semibold tracking-tight">{title}</h2>
		{#if headerActions}
			<div class="flex items-center gap-2">
				{@render headerActions()}
			</div>
		{/if}
	</div>

	{#if events.length === 0}
		<div
			class="bg-muted/40 text-muted-foreground rounded-3xl border border-dashed px-4 py-10 text-center text-sm"
		>
			{emptyMessage}
		</div>
	{:else}
		<ol class="m-0 list-none p-0">
			{#each events as event, index (event.id)}
				<li>
					<TimelineEventCard
						kind={event.kind}
						title={event.title}
						body={event.body}
						occurredAt={event.occurredAt}
						actor={event.actor}
						isLast={index === events.length - 1}
					/>
				</li>
			{/each}
		</ol>
	{/if}
</section>
