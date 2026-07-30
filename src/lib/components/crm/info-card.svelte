<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface InfoCardField {
		label: string;
		value: string;
	}

	export interface InfoCardProps {
		title: string;
		fields?: InfoCardField[];
		class?: string;
		children?: Snippet;
	}

	let { title, fields = [], class: className, children }: InfoCardProps = $props();
</script>

<Card.Root class={cn(className)} size="sm">
	<Card.Header>
		<Card.Title class="text-base">{title}</Card.Title>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#each fields as field (field.label)}
			<div class="space-y-1">
				<p class="text-muted-foreground text-xs">{field.label}</p>
				<p class="text-sm font-medium">{field.value}</p>
			</div>
		{/each}
		{#if children}
			{@render children()}
		{/if}
	</Card.Content>
</Card.Root>
