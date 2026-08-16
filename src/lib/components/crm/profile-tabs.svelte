<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface ProfileTab {
		id: string;
		label: string;
	}

	export interface ProfileTabsProps {
		tabs: ProfileTab[];
		value?: string;
		class?: string;
		children?: Snippet<[{ active: string }]>;
	}

	let {
		tabs,
		value = $bindable(tabs[0]?.id ?? 'details'),
		class: className,
		children
	}: ProfileTabsProps = $props();
</script>

<Tabs.Root bind:value class={cn('flex w-full min-h-0 flex-1 flex-col', className)}>
	<Tabs.List variant="line" class="w-full shrink-0 justify-start overflow-x-auto">
		{#each tabs as tab (tab.id)}
			<Tabs.Trigger value={tab.id}>{tab.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>
	{#if children}
		<div class="mt-6 flex min-h-0 flex-1 flex-col">
			{@render children({ active: value })}
		</div>
	{/if}
</Tabs.Root>
