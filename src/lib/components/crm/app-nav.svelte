<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
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

	const sidebar = Sidebar.useSidebar();

	function closeMobileNav() {
		if (sidebar.isMobile) sidebar.setOpenMobile(false);
	}
</script>

<Sidebar.Root collapsible="offcanvas" class={cn('h-full border-r', className)}>
	<Sidebar.Header class="gap-1 px-4 py-5">
		<p class="text-lg font-semibold tracking-tight">Headquarters</p>
		<p class="text-muted-foreground text-xs">{orgName}</p>
	</Sidebar.Header>

	<Sidebar.Content class="gap-0 px-2 pb-4">
		{#each groups as group, gi (group.label ?? gi)}
			<Sidebar.Group class="p-0 py-2">
				{#if group.label}
					<Sidebar.GroupLabel class="text-[11px] tracking-wide uppercase">
						{group.label}
					</Sidebar.GroupLabel>
				{/if}
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each group.items as item (item.href + item.label)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton isActive={!!item.active}>
									{#snippet child({ props })}
										<a
											href={item.href}
											aria-current={item.active ? 'page' : undefined}
											{...props}
											onclick={(event) => {
												props.onclick?.(event);
												closeMobileNav();
											}}
										>
											<span>{item.label}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/each}
	</Sidebar.Content>

	<Sidebar.Footer class="text-muted-foreground border-t px-4 py-4 text-xs">
		{footerLabel}
	</Sidebar.Footer>
</Sidebar.Root>
