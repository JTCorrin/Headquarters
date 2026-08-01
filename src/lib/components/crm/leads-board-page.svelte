<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { LeadFormData } from '$lib/schemas/lead.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import LeadsBoard, { type LeadCard } from './leads-board.svelte';
	import LeadFormDrawer from './lead-form-drawer.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface LeadsBoardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		leads: LeadCard[];
		leadForm: SuperForm<LeadFormData>;
		drawerOpen?: boolean;
		viewState?: ResourceViewState;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onSelectLead?: (id: string) => void;
		onReload?: () => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		leads,
		leadForm,
		drawerOpen = $bindable(false),
		viewState = { kind: 'ready' },
		showNav = true,
		class: className,
		onSelectLead,
		onReload,
		onValidSubmit
	}: LeadsBoardPageProps = $props();
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="shrink-0" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Headquarters"
				title="Leads"
				description="Pipeline board — create leads, open a card for edit/convert. Won only via convert."
			>
				{#snippet actions()}
					<Button variant="outline" size="sm">Table view</Button>
					<LeadFormDrawer
						bind:open={drawerOpen}
						form={leadForm}
						{onValidSubmit}
						triggerLabel="New lead"
					/>
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if viewState.kind === 'ready' || viewState.kind === 'empty'}
				{#if leads.length === 0}
					<p
						class="text-muted-foreground rounded-3xl border border-dashed px-4 py-12 text-center text-sm"
					>
						No leads yet — create one to populate the board.
					</p>
				{:else}
					<LeadsBoard {leads} class="min-h-[480px]" {onSelectLead} />
				{/if}
			{/if}
		</div>
	</main>
</div>
