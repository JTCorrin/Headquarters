<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface StatCardProps {
		label: string;
		value: string;
		hint?: string;
		class?: string;
		action?: Snippet;
	}

	let { label, value, hint, class: className, action }: StatCardProps = $props();
</script>

<Card.Root class={cn(className)} size="sm">
	<Card.Header class="gap-1">
		<Card.Description>{label}</Card.Description>
		<Card.Title class="text-3xl font-semibold tracking-tight">{value}</Card.Title>
		{#if hint}
			<p class="text-muted-foreground text-xs">{hint}</p>
		{/if}
		{#if action}
			<Card.Action>{@render action()}</Card.Action>
		{/if}
	</Card.Header>
</Card.Root>
