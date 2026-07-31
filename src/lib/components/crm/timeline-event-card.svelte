<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import {
		timelineKindLabel,
		timelineKindMarkerClass,
		type TimelineEventKind
	} from './timeline-kinds.js';
	import {
		renderTimelineMarkdown,
		timelineAccentMarkerClass
	} from './timeline-accents.js';
	import TimelineIcon from './timeline-icon.svelte';

	export interface TimelineEventCardProps {
		kind: TimelineEventKind | string;
		title: string;
		body?: string;
		occurredAt: string;
		actor?: string;
		accent?: string;
		icon?: string;
		/** Hide the connecting rail below this event (last item). */
		isLast?: boolean;
		/** Start expanded (also expands on hover/focus by default). */
		defaultExpanded?: boolean;
		class?: string;
	}

	let {
		kind,
		title,
		body,
		occurredAt,
		actor,
		accent,
		icon,
		isLast = false,
		defaultExpanded = false,
		class: className
	}: TimelineEventCardProps = $props();

	const kindLabel = $derived(timelineKindLabel(kind));
	const markerClass = $derived(
		timelineAccentMarkerClass(accent) ?? timelineKindMarkerClass(kind)
	);
	const hasBody = $derived(!!body?.trim());
	const looksLikeMarkdown = $derived(
		!!body && /(\*\*|`|^[-*]\s|\[.+\]\(https?:\/\/)/m.test(body)
	);
</script>

<article
	class={cn(
		'group/timeline-card relative flex gap-3',
		hasBody && 'cursor-default',
		className
	)}
>
	<div class="flex w-3 shrink-0 flex-col items-center">
		<span
			class={cn(
				'mt-3 size-2.5 rounded-full ring-4 ring-background transition-transform duration-300 ease-out',
				'group-hover/timeline-card:scale-125 group-focus-within/timeline-card:scale-125',
				markerClass
			)}
			aria-hidden="true"
		></span>
		{#if !isLast}
			<span class="bg-border mt-1 w-px flex-1" aria-hidden="true"></span>
		{/if}
	</div>

	<Card.Root
		class={cn(
			'mb-3 min-w-0 flex-1 transition-[box-shadow,transform] duration-300 ease-out',
			'group-hover/timeline-card:-translate-y-0.5 group-hover/timeline-card:shadow-lg',
			'group-focus-within/timeline-card:-translate-y-0.5 group-focus-within/timeline-card:shadow-lg'
		)}
		size="sm"
		tabindex={hasBody ? 0 : undefined}
	>
		<Card.Header class="gap-1.5">
			<div class="flex items-start gap-2">
				{#if icon}
					<span
						class="bg-muted text-muted-foreground mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-lg"
					>
						<TimelineIcon name={icon} />
					</span>
				{/if}
				<div class="min-w-0 flex-1 space-y-1.5">
					<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
						{occurredAt} · {kindLabel}
						{#if actor}
							<span class="normal-case tracking-normal"> · {actor}</span>
						{/if}
					</p>
					<Card.Title class="text-base font-semibold">{title}</Card.Title>
					{#if hasBody}
						<div
							class={cn(
								'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
								defaultExpanded
									? 'grid-rows-[1fr] opacity-100'
									: 'grid-rows-[0fr] opacity-70 group-hover/timeline-card:grid-rows-[1fr] group-hover/timeline-card:opacity-100 group-focus-within/timeline-card:grid-rows-[1fr] group-focus-within/timeline-card:opacity-100'
							)}
						>
							<div class="overflow-hidden">
								{#if looksLikeMarkdown}
									<div
										class="text-muted-foreground pt-1 text-sm leading-relaxed [&_a]:underline"
									>
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										{@html renderTimelineMarkdown(body ?? '')}
									</div>
								{:else}
									<Card.Description class="pt-1 text-sm leading-relaxed">
										{body}
									</Card.Description>
								{/if}
							</div>
						</div>
						{#if !defaultExpanded}
							<p
								class="text-muted-foreground text-[11px] transition-opacity duration-200 group-hover/timeline-card:opacity-0 group-focus-within/timeline-card:opacity-0"
							>
								Hover to expand
							</p>
						{/if}
					{/if}
				</div>
			</div>
		</Card.Header>
	</Card.Root>
</article>
