<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import { cn } from '$lib/utils.js';

	export interface AppSidebarFrameProps {
		orgName?: string;
		groups?: AppNavGroup[];
		showNav?: boolean;
		/** Render a compact trigger bar (for isolated pages / Storybook). AppShell supplies its own. */
		showTrigger?: boolean;
		class?: string;
		children?: Snippet;
		'data-testid'?: string;
	}

	let {
		orgName,
		groups,
		showNav = false,
		showTrigger = false,
		class: className,
		children,
		'data-testid': testId
	}: AppSidebarFrameProps = $props();

	const navVisible = $derived(Boolean(showNav && orgName && groups && groups.length > 0));
</script>

{#if navVisible && orgName && groups}
	<Sidebar.Provider
		class={cn('bg-background text-foreground min-h-0 w-full', className)}
		style="--sidebar-width: 14rem;"
		data-testid={testId}
	>
		<AppNav {orgName} groups={groups} />
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			{#if showTrigger}
				<div class="flex items-center border-b px-3 py-2 md:hidden">
					<Sidebar.Trigger data-testid="app-sidebar-trigger" />
				</div>
			{/if}
			{@render children?.()}
		</div>
	</Sidebar.Provider>
{:else}
	<div class={cn('bg-background text-foreground flex min-h-0 flex-1 flex-col', className)} data-testid={testId}>
		{@render children?.()}
	</div>
{/if}
