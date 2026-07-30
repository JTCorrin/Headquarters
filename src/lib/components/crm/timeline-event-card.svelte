<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import {
		timelineKindLabel,
		timelineKindMarkerClass,
		type TimelineEventKind
	} from './timeline-kinds.js';

	export interface TimelineEventCardProps {
		kind: TimelineEventKind | string;
		title: string;
		body?: string;
		occurredAt: string;
		actor?: string;
		/** Hide the connecting rail below this event (last item). */
		isLast?: boolean;
		class?: string;
	}

	let {
		kind,
		title,
		body,
		occurredAt,
		actor,
		isLast = false,
		class: className
	}: TimelineEventCardProps = $props();

	const kindLabel = $derived(timelineKindLabel(kind));
	const markerClass = $derived(timelineKindMarkerClass(kind));
</script>

<article class={cn('relative flex gap-3', className)}>
	<div class="flex w-3 shrink-0 flex-col items-center">
		<span class={cn('mt-3 size-2.5 rounded-full ring-4 ring-background', markerClass)} aria-hidden="true"></span>
		{#if !isLast}
			<span class="bg-border mt-1 w-px flex-1" aria-hidden="true"></span>
		{/if}
	</div>

	<Card.Root class="mb-3 min-w-0 flex-1" size="sm">
		<Card.Header class="gap-1.5">
			<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
				{occurredAt} · {kindLabel}
				{#if actor}
					<span class="normal-case tracking-normal"> · {actor}</span>
				{/if}
			</p>
			<Card.Title class="text-base font-semibold">{title}</Card.Title>
			{#if body}
				<Card.Description class="text-sm leading-relaxed">{body}</Card.Description>
			{/if}
		</Card.Header>
	</Card.Root>
</article>
