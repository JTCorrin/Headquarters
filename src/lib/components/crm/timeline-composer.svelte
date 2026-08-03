<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';
	import {
		TIMELINE_ACCENTS,
		TIMELINE_ICONS,
		renderTimelineMarkdown,
		type TimelineAccentId,
		type TimelineIconId
	} from './timeline-accents.js';
	import {
		COMPOSABLE_TIMELINE_EVENT_KINDS,
		TIMELINE_KIND_META,
		isComposableTimelineEventKind,
		type TimelineEventKind
	} from './timeline-kinds.js';
	import TimelineIcon from './timeline-icon.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	export interface TimelineComposerSubmit {
		kind: TimelineEventKind;
		title: string;
		body: string;
		accent: TimelineAccentId;
		icon: TimelineIconId;
	}

	export interface TimelineComposerProps {
		actor?: string;
		/** When false (default), only a compact “Add note” control is shown. */
		defaultExpanded?: boolean;
		class?: string;
		onSubmit?: (event: TimelineComposerSubmit) => void;
	}

	let {
		actor = 'You',
		defaultExpanded = false,
		class: className,
		onSubmit
	}: TimelineComposerProps = $props();

	let expanded = $state(defaultExpanded);
	let kind = $state<TimelineEventKind>('note');
	let title = $state('');
	let body = $state('');
	let accent = $state<TimelineAccentId>('slate');
	let icon = $state<TimelineIconId>('note');
	let mode = $state<'write' | 'preview'>('write');

	const kindLabel = $derived(TIMELINE_KIND_META[kind].label);

	const kindDefaultAccent: Record<TimelineEventKind, TimelineAccentId> = {
		note: 'slate',
		email: 'sky',
		call: 'violet',
		payment: 'emerald',
		document: 'amber',
		status: 'orange',
		meeting: 'indigo',
		task: 'rose',
		conversion: 'violet'
	};

	function onKindChange(next: string) {
		if (!isComposableTimelineEventKind(next)) return;
		kind = next;
		accent = kindDefaultAccent[kind];
		icon = kind as TimelineIconId;
	}

	function collapse() {
		expanded = false;
		mode = 'write';
	}

	function submit() {
		const trimmedBody = body.trim();
		const trimmedTitle = title.trim() || trimmedBody.split('\n')[0]?.slice(0, 80) || 'Untitled note';
		if (!trimmedBody && !title.trim()) return;
		onSubmit?.({
			kind,
			title: trimmedTitle,
			body: trimmedBody,
			accent,
			icon
		});
		title = '';
		body = '';
		mode = 'write';
		expanded = false;
	}
</script>

{#if !expanded}
	<button
		type="button"
		class={cn(
			'bg-card hover:bg-muted/50 flex w-full items-center justify-between gap-3 rounded-3xl px-4 py-3 text-left ring-1 ring-foreground/5 transition-colors dark:ring-foreground/10',
			className
		)}
		onclick={() => (expanded = true)}
	>
		<span class="flex min-w-0 items-center gap-2">
			<span
				class="bg-muted text-muted-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-xl"
			>
				<PlusIcon class="size-3.5" />
			</span>
			<span class="min-w-0">
				<span class="block text-sm font-semibold tracking-tight">Add to timeline</span>
				<span class="text-muted-foreground block truncate text-xs">
					Note or event · colour & icon · markdown
				</span>
			</span>
		</span>
		<ChevronDownIcon class="text-muted-foreground size-4 shrink-0" />
	</button>
{:else}
	<form
		class={cn(
			'bg-card space-y-3 rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10',
			className
		)}
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<p class="text-sm font-semibold tracking-tight">Add to timeline</p>
				<p class="text-muted-foreground text-xs">
					Ad-hoc note or event · markdown ok · posting as {actor}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<div class="flex gap-1 rounded-full bg-muted/60 p-0.5">
					<button
						type="button"
						class={cn(
							'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
							mode === 'write' ? 'bg-background shadow-sm' : 'text-muted-foreground'
						)}
						onclick={() => (mode = 'write')}
					>
						Write
					</button>
					<button
						type="button"
						class={cn(
							'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
							mode === 'preview' ? 'bg-background shadow-sm' : 'text-muted-foreground'
						)}
						onclick={() => (mode = 'preview')}
					>
						Preview
					</button>
				</div>
				<Button type="button" size="sm" variant="ghost" onclick={collapse}>Collapse</Button>
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.45fr)]">
			<div class="space-y-2">
				<Label for="timeline-title">Title</Label>
				<Input
					id="timeline-title"
					bind:value={title}
					placeholder="Optional — defaults to first line"
				/>
			</div>
			<div class="space-y-2">
				<Label for="timeline-kind">Category</Label>
				<Select.Root
					type="single"
					value={kind}
					onValueChange={(v) => {
						if (v) onKindChange(v);
					}}
				>
					<Select.Trigger id="timeline-kind" class="w-full">{kindLabel}</Select.Trigger>
					<Select.Content>
						{#each COMPOSABLE_TIMELINE_EVENT_KINDS as option (option)}
							<Select.Item value={option} label={TIMELINE_KIND_META[option].label}>
								{TIMELINE_KIND_META[option].label}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<div class="space-y-2">
			<Label>Colour</Label>
			<div class="flex flex-wrap gap-1.5">
				{#each TIMELINE_ACCENTS as option (option.id)}
					<button
						type="button"
						title={option.label}
						aria-label={option.label}
						aria-pressed={accent === option.id}
						class={cn(
							'size-6 rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform',
							option.swatchClass,
							accent === option.id
								? 'scale-110 ring-foreground'
								: 'ring-transparent hover:scale-105'
						)}
						onclick={() => (accent = option.id)}
					></button>
				{/each}
			</div>
		</div>

		<div class="space-y-2">
			<Label>Icon</Label>
			<div class="flex flex-wrap gap-1">
				{#each TIMELINE_ICONS as option (option.id)}
					<button
						type="button"
						title={option.label}
						aria-label={option.label}
						aria-pressed={icon === option.id}
						class={cn(
							'inline-flex size-8 items-center justify-center rounded-xl ring-1 transition-colors',
							icon === option.id
								? 'bg-foreground text-background ring-foreground'
								: 'bg-background text-foreground ring-foreground/10 hover:bg-muted'
						)}
						onclick={() => (icon = option.id)}
					>
						<TimelineIcon name={option.id} />
					</button>
				{/each}
			</div>
		</div>

		<div class="space-y-2">
			<Label for="timeline-body">Body</Label>
			{#if mode === 'write'}
				<Textarea
					id="timeline-body"
					bind:value={body}
					rows={4}
					placeholder={"Supports **bold**, *italic*, `code`, lists, and [links](https://…)."}
					class="min-h-[96px] resize-y font-mono text-sm"
				/>
			{:else}
				<div class="bg-muted/40 min-h-[96px] rounded-2xl px-3 py-2 text-sm leading-relaxed">
					{#if body.trim()}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html renderTimelineMarkdown(body)}
					{:else}
						<p class="text-muted-foreground">Nothing to preview yet.</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="flex justify-end gap-2">
			<Button type="button" size="sm" variant="outline" onclick={collapse}>Cancel</Button>
			<Button type="submit" size="sm" disabled={!title.trim() && !body.trim()}>
				Add to timeline
			</Button>
		</div>
	</form>
{/if}
