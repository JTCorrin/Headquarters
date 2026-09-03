<script lang="ts">
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import CampaignsTable from './campaigns-table.svelte';
	import type { CampaignRow } from './campaigns-columns.js';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface CampaignsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: CampaignRow[];
		viewState?: ResourceViewState;
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onNewCampaign?: () => void;
	}

	let {
		orgName,
		navGroups,
		rows,
		viewState = { kind: 'ready' },
		showNav = true,
		class: className,
		onReload,
		onNewCampaign
	}: CampaignsListPageProps = $props();
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
			{#if viewState.kind === 'empty' || viewState.kind === 'validation'}
				<ResourceStateBanner state={viewState} onReload={onReload} />
			{/if}

			<PageHeader
				breadcrumb="Comms"
				title="Campaigns"
				description="Send templated email to tagged leads, contacts, and clients."
			>
				{#snippet actions()}
					{#if onNewCampaign}
						<Button type="button" size="sm" onclick={onNewCampaign}>New campaign</Button>
					{/if}
				{/snippet}
			</PageHeader>

			<CampaignsTable {rows} />
		</div>
	</main>
</AppSidebarFrame>
