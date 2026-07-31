<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button/index.js';

	export type ResourceViewState =
		| { kind: 'ready' }
		| { kind: 'loading' }
		| { kind: 'empty'; message?: string }
		| { kind: 'forbidden'; message?: string }
		| { kind: 'not_found'; message?: string }
		| { kind: 'conflict'; message?: string }
		| { kind: 'validation'; message?: string; fields?: Record<string, string> };

	export interface ResourceStateBannerProps {
		state: ResourceViewState;
		class?: string;
		onRetry?: () => void;
		onReload?: () => void;
	}

	let { state, class: className, onRetry, onReload }: ResourceStateBannerProps = $props();
</script>

{#if state.kind !== 'ready'}
	<div
		class={cn(
			'rounded-3xl px-4 py-3 text-sm ring-1',
			state.kind === 'loading' && 'bg-muted/40 text-muted-foreground ring-foreground/5',
			state.kind === 'empty' && 'bg-muted/40 text-muted-foreground ring-foreground/5',
			state.kind === 'forbidden' && 'bg-destructive/10 text-destructive ring-destructive/20',
			state.kind === 'not_found' && 'bg-muted/50 text-foreground ring-foreground/10',
			state.kind === 'conflict' && 'bg-amber-500/10 text-amber-950 ring-amber-500/30 dark:text-amber-100',
			state.kind === 'validation' && 'bg-destructive/10 text-destructive ring-destructive/20',
			className
		)}
		role="status"
	>
		{#if state.kind === 'loading'}
			<p>Loading…</p>
		{:else if state.kind === 'empty'}
			<p>{state.message ?? 'Nothing here yet.'}</p>
		{:else if state.kind === 'forbidden'}
			<p class="font-medium">403 — {state.message ?? 'You do not have access.'}</p>
		{:else if state.kind === 'not_found'}
			<p class="font-medium">404 — {state.message ?? 'Not found.'}</p>
		{:else if state.kind === 'conflict'}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="font-medium">
					412 — {state.message ?? 'Version conflict. Reload and try again.'}
				</p>
				{#if onReload}
					<Button type="button" size="sm" variant="outline" onclick={onReload}>Reload</Button>
				{/if}
			</div>
		{:else}
			<p class="font-medium">422 — {state.message ?? 'Validation failed.'}</p>
			{#if state.fields}
				<ul class="mt-2 list-disc space-y-0.5 pl-5 text-xs">
					{#each Object.entries(state.fields) as [field, message] (field)}
						<li><span class="font-mono">{field}</span>: {message}</li>
					{/each}
				</ul>
			{/if}
			{#if onRetry}
				<div class="mt-2">
					<Button type="button" size="sm" variant="outline" onclick={onRetry}>Dismiss</Button>
				</div>
			{/if}
		{/if}
	</div>
{/if}
