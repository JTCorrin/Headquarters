<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ClientFormData } from '$lib/schemas/client.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
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
		class?: string;
		onReload?: () => void;
	}

	let {
		orgName,
		navGroups,
		rows,
		clientForm,
		drawerOpen = $bindable(false),
		viewState = { kind: 'ready' },
		class: className,
		onReload
	}: ClientsListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Headquarters"
				title="Clients"
				description="Won accounts — money, contacts, and activity live on the profile."
			>
				{#snippet actions()}
					<Button type="button" variant="outline" size="sm">Import</Button>
					<ClientFormDrawer bind:open={drawerOpen} form={clientForm}>
						{#snippet trigger()}
							<Button type="button" size="sm">New client</Button>
						{/snippet}
					</ClientFormDrawer>
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
</div>
