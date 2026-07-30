<script lang="ts">
	import { cn } from '$lib/utils.js';

	export interface AppNavItem {
		label: string;
		href: string;
		active?: boolean;
	}

	export interface AppNavGroup {
		label?: string;
		items: AppNavItem[];
	}

	export interface AppNavProps {
		orgName: string;
		groups: AppNavGroup[];
		footerLabel?: string;
		class?: string;
	}

	let {
		orgName,
		groups,
		footerLabel = 'Settings · Team',
		class: className
	}: AppNavProps = $props();
</script>

<aside
	class={cn(
		'bg-sidebar text-sidebar-foreground flex h-full w-56 flex-col border-r border-sidebar-border',
		className
	)}
>
	<div class="space-y-1 px-4 py-5">
		<p class="text-lg font-semibold tracking-tight">CRM</p>
		<p class="text-muted-foreground text-xs">{orgName}</p>
	</div>

	<nav class="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
		{#each groups as group, gi (group.label ?? gi)}
			<div class="space-y-1">
				{#if group.label}
					<p class="text-muted-foreground px-2 text-[11px] font-medium tracking-wide uppercase">
						{group.label}
					</p>
				{/if}
				{#each group.items as item (item.href + item.label)}
					<a
						href={item.href}
						class={cn(
							'block rounded-xl px-3 py-2 text-sm transition-colors',
							item.active
								? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
								: 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'
						)}
						aria-current={item.active ? 'page' : undefined}
					>
						{item.label}
					</a>
				{/each}
			</div>
		{/each}
	</nav>

	<div class="text-muted-foreground border-t border-sidebar-border px-4 py-4 text-xs">
		{footerLabel}
	</div>
</aside>
