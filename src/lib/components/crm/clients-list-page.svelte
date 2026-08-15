<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ClientFormData } from '$lib/schemas/client.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import ClientsTable from './clients-table.svelte';
	import type { ClientRow } from './clients-columns.js';
	import ClientFormDrawer from './client-form-drawer.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ClientsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: ClientRow[];
		clientForm: SuperForm<ClientFormData>;
		drawerOpen?: boolean;
		viewState?: ResourceViewState;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		rows,
		clientForm,
		drawerOpen = $bindable(false),
		viewState = { kind: 'ready' },
		showNav = true,
		class: className,
		onReload,
		onValidSubmit
	}: ClientsListPageProps = $props();
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
			<PageHeader title="Clients">
				{#snippet actions()}
					<Button type="button" variant="outline" size="sm">Import</Button>
					<ClientFormDrawer
						bind:open={drawerOpen}
						form={clientForm}
						{onValidSubmit}
						triggerLabel="New client"
					/>
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if viewState.kind === 'ready' || viewState.kind === 'empty'}
				{#if rows.length === 0}
					<p
						class="text-muted-foreground rounded-3xl border border-dashed px-4 py-12 text-center text-sm"
					>
						No clients yet — create one or convert a lead.
					</p>
				{:else}
					<ClientsTable {rows} />
				{/if}
			{/if}
		</div>
	</main>
</AppSidebarFrame>
