<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils.js';
	import TimelineEventCard from './timeline-event-card.svelte';
	import TimelineComposer, { type TimelineComposerSubmit } from './timeline-composer.svelte';
	import type { TimelineEventKind } from './timeline-kinds.js';
	import type { TimelineAccentId, TimelineIconId } from './timeline-accents.js';
	import type { Snippet } from 'svelte';

	export interface TimelineEvent {
		id: string;
		kind: TimelineEventKind | string;
		title: string;
		body?: string;
		occurredAt: string;
		actor?: string;
		accent?: TimelineAccentId | string;
		icon?: TimelineIconId | string;
		/** Primary entity for deep-links (org Home feed). */
		entityType?: string;
		entityId?: string;
		/** Profile href when `entityType` + `entityId` map to a route. */
		href?: string;
	}

	export interface TimelineProps {
		events: TimelineEvent[];
		title?: string;
		emptyMessage?: string;
		/** Show the ad-hoc note/event composer above the list. */
		composable?: boolean;
		composerActor?: string;
		/** Override `?timeline=` focus (tests). */
		focusEventId?: string | null;
		class?: string;
		headerActions?: Snippet;
		onAdd?: (event: TimelineComposerSubmit) => void;
	}

	let {
		events = $bindable<TimelineEvent[]>([]),
		title = 'Timeline',
		emptyMessage = 'No activity yet.',
		composable = false,
		composerActor = 'You',
		focusEventId = null,
		class: className,
		headerActions,
		onAdd
	}: TimelineProps = $props();

	const resolvedFocusId = $derived.by(() => {
		if (focusEventId) return focusEventId;
		try {
			return page.url.searchParams.get('timeline');
		} catch {
			return null;
		}
	});

	function handleComposerSubmit(payload: TimelineComposerSubmit) {
		if (onAdd) {
			onAdd(payload);
			return;
		}
		events = [
			{
				id: crypto.randomUUID(),
				kind: payload.kind,
				title: payload.title,
				body: payload.body || undefined,
				occurredAt: 'Just now',
				actor: composerActor,
				accent: payload.accent,
				icon: payload.icon
			},
			...events
		];
	}
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

	{#if composable}
		<TimelineComposer
			actor={composerActor}
			class="mb-4"
			onSubmit={handleComposerSubmit}
		/>
	{/if}

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
						eventId={event.id}
						kind={event.kind}
						title={event.title}
						body={event.body}
						occurredAt={event.occurredAt}
						actor={event.actor}
						accent={event.accent}
						icon={event.icon}
						href={event.href}
						highlighted={resolvedFocusId === event.id}
						isLast={index === events.length - 1}
					/>
				</li>
			{/each}
		</ol>
	{/if}
</section>
