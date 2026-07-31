<script lang="ts">
	import StatusBadge from './status-badge.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface PageHeaderProps {
		title: string;
		description?: string;
		breadcrumb?: string;
		status?: string;
		class?: string;
		actions?: Snippet;
	}

	let {
		title,
		description,
		breadcrumb,
		status,
		class: className,
		actions
	}: PageHeaderProps = $props();
</script>

<header class={cn('flex flex-wrap items-start justify-between gap-4', className)}>
	<div class="space-y-1">
		{#if breadcrumb}
			<p class="text-muted-foreground text-sm">{breadcrumb}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
			{#if status}
				<StatusBadge {status} />
			{/if}
		</div>
		{#if description}
			<p class="text-muted-foreground text-sm">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</header>
