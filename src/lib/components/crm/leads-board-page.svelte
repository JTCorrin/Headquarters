<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { LeadClientOption, LeadFormData } from '$lib/schemas/lead.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import LeadsBoard, { type LeadBoardMove, type LeadCard } from './leads-board.svelte';
	import { leadCardToRow } from './leads-columns.js';
	import LeadsTable from './leads-table.svelte';
	import LeadFormDrawer from './lead-form-drawer.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export type LeadsViewMode = 'board' | 'table';

	export interface LeadsBoardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		leads: LeadCard[];
		leadForm: SuperForm<LeadFormData>;
		clientOptions?: LeadClientOption[];
		orgCurrency?: string | null;
		viewMode?: LeadsViewMode;
		drawerOpen?: boolean;
		viewState?: ResourceViewState;
		/** Transient board interaction error (move blocked / PATCH failed). */
		boardError?: string | null;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onSelectLead?: (id: string) => void;
		onMoveLead?: (move: LeadBoardMove) => void | Promise<void>;
		onMoveBlocked?: (message: string) => void;
		onReload?: () => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onCreateClient?: () => void;
		onViewModeChange?: (mode: LeadsViewMode) => void;
	}

	let {
		orgName,
		navGroups,
		leads,
		leadForm,
		clientOptions = [],
		orgCurrency = null,
		viewMode = 'board',
		drawerOpen = $bindable(false),
		viewState = { kind: 'ready' },
		boardError = null,
		showNav = true,
		class: className,
		onSelectLead,
		onMoveLead,
		onMoveBlocked,
		onReload,
		onValidSubmit,
		onCreateClient,
		onViewModeChange
	}: LeadsBoardPageProps = $props();

	const tableRows = $derived(leads.map(leadCardToRow));
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
			<PageHeader title={viewMode === 'table' ? 'Leads table' : 'Leads'}>
				{#snippet actions()}
					{#if viewMode === 'table'}
						<Button
							type="button"
							variant="outline"
							size="sm"
							data-testid="leads-board-view"
							onclick={() => onViewModeChange?.('board')}
						>
							Board view
						</Button>
					{:else}
						<Button
							type="button"
							variant="outline"
							size="sm"
							data-testid="leads-table-view"
							onclick={() => onViewModeChange?.('table')}
						>
							Table view
						</Button>
					{/if}
					<LeadFormDrawer
						bind:open={drawerOpen}
						form={leadForm}
						{clientOptions}
						{orgCurrency}
						{onValidSubmit}
						{onCreateClient}
						triggerLabel="New lead"
					/>
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if boardError && viewMode === 'board'}
				<p
					class="text-destructive rounded-3xl bg-destructive/10 px-4 py-3 text-sm"
					role="alert"
					data-testid="leads-board-error"
				>
					{boardError}
				</p>
			{/if}

			{#if viewState.kind === 'ready' || viewState.kind === 'empty'}
				{#if leads.length === 0}
					<p
						class="text-muted-foreground rounded-3xl border border-dashed px-4 py-12 text-center text-sm"
					>
						No leads yet — create one to populate the board.
					</p>
				{:else if viewMode === 'table'}
					<LeadsTable rows={tableRows} />
				{:else}
					<LeadsBoard
						{leads}
						class="min-h-[480px]"
						{onSelectLead}
						{onMoveLead}
						{onMoveBlocked}
					/>
				{/if}
			{/if}
		</div>
	</main>
</AppSidebarFrame>
