<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';
	import AiAssistAction from './ai-assist-action.svelte';
	import type { Snippet } from 'svelte';

	export type AiSuggestionStatus = 'idle' | 'generating' | 'ready';

	export interface AiSuggestionVariant {
		id: string;
		label: string;
	}

	export interface AiSuggestionPanelProps {
		title?: string;
		hint?: string;
		status?: AiSuggestionStatus;
		value?: string;
		generateLabel?: string;
		useLabel?: string;
		variants?: AiSuggestionVariant[];
		activeVariant?: string;
		class?: string;
		onGenerate?: () => void;
		onUse?: () => void;
		onDiscard?: () => void;
		onVariantChange?: (id: string) => void;
		footer?: Snippet;
	}

	let {
		title = 'AI suggestion',
		hint = 'Task-specific assist — edit before you use it. No chat window.',
		status = 'idle',
		value = $bindable(''),
		generateLabel = 'Generate',
		useLabel = 'Use suggestion',
		variants = [],
		activeVariant = $bindable<string | undefined>(undefined),
		class: className,
		onGenerate,
		onUse,
		onDiscard,
		onVariantChange,
		footer
	}: AiSuggestionPanelProps = $props();
</script>

<section
	class={cn(
		'bg-card space-y-3 rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-sm font-semibold tracking-tight">{title}</p>
			<p class="text-muted-foreground text-xs">{hint}</p>
		</div>
		{#if status !== 'ready'}
			<AiAssistAction
				label={generateLabel}
				busy={status === 'generating'}
				onclick={() => onGenerate?.()}
			/>
		{:else}
			<AiAssistAction
				label="Regenerate"
				busy={false}
				onclick={() => onGenerate?.()}
			/>
		{/if}
	</div>

	{#if variants.length}
		<div class="flex flex-wrap gap-1.5">
			{#each variants as variant (variant.id)}
				<button
					type="button"
					class={cn(
						'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
						activeVariant === variant.id
							? 'bg-foreground text-background ring-foreground'
							: 'bg-background text-foreground ring-foreground/10 hover:bg-muted'
					)}
					onclick={() => {
						activeVariant = variant.id;
						onVariantChange?.(variant.id);
					}}
				>
					{variant.label}
				</button>
			{/each}
		</div>
	{/if}

	{#if status === 'idle'}
		<p class="text-muted-foreground rounded-2xl bg-muted/40 px-3 py-6 text-center text-sm">
			Run the assist when you want a draft — you stay in control of send/save.
		</p>
	{:else if status === 'generating'}
		<p class="text-muted-foreground rounded-2xl bg-muted/40 px-3 py-6 text-center text-sm">
			Drafting…
		</p>
	{:else}
		<Textarea bind:value rows={8} class="min-h-[160px] resize-y font-sans text-sm" />
		<div class="flex flex-wrap justify-end gap-2">
			{#if onDiscard}
				<Button type="button" size="sm" variant="ghost" onclick={() => onDiscard?.()}>
					Discard
				</Button>
			{/if}
			{#if onUse}
				<Button type="button" size="sm" onclick={() => onUse?.()}>{useLabel}</Button>
			{/if}
		</div>
	{/if}

	{#if footer}
		{@render footer()}
	{/if}
</section>
