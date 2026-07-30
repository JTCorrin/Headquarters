<script lang="ts">
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface ProfileHeaderProps {
		title: string;
		breadcrumb?: string;
		subtitle?: string;
		status?: string;
		class?: string;
		actions?: Snippet;
	}

	let {
		title,
		breadcrumb,
		subtitle,
		status,
		class: className,
		actions
	}: ProfileHeaderProps = $props();
</script>

<header class={cn('flex flex-wrap items-start justify-between gap-4', className)}>
	<div class="space-y-2">
		{#if breadcrumb}
			<p class="text-muted-foreground text-sm">{breadcrumb}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
			{#if status}
				<StatusBadge {status} />
			{/if}
		</div>
		{#if subtitle}
			<p class="text-muted-foreground text-sm">{subtitle}</p>
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-2">
		{#if actions}
			{@render actions()}
		{:else}
			<Button variant="outline" size="sm">Email</Button>
			<Button size="sm">Edit</Button>
		{/if}
	</div>
</header>
