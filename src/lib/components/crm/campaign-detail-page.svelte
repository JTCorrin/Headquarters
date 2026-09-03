<script lang="ts">
	import type { ApiCampaign, ApiCampaignRecipient } from '$lib/api/v1/types.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import DataTableShell from './data-table-shell.svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { renderComponent } from '$lib/components/ui/data-table/index.js';
	import StatusBadge from './status-badge.svelte';
	import DataTableSortHeader from './data-table-sort-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface CampaignDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		campaign: ApiCampaign;
		recipients: ApiCampaignRecipient[];
		viewState?: ResourceViewState;
		busy?: boolean;
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onBack?: () => void;
		onCancel?: () => void | Promise<void>;
	}

	let {
		orgName,
		navGroups,
		campaign,
		recipients,
		viewState = { kind: 'ready' },
		busy = false,
		showNav = true,
		class: className,
		onReload,
		onBack,
		onCancel
	}: CampaignDetailPageProps = $props();

	const statusLabel = $derived(
		campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)
	);

	const canCancel = $derived(campaign.status === 'scheduled' || campaign.status === 'sending');

	const recipientColumns: ColumnDef<ApiCampaignRecipient>[] = [
		{
			accessorKey: 'to_name',
			header: ({ column }) =>
				renderComponent(DataTableSortHeader, {
					label: 'Recipient',
					onclick: column.getToggleSortingHandler()
				}),
			cell: ({ row }) => row.original.to_name ?? row.original.entity_type
		},
		{
			accessorKey: 'to_email',
			header: 'Email'
		},
		{
			accessorKey: 'entity_type',
			header: 'Type'
		},
		{
			accessorKey: 'status',
			header: 'Status',
			cell: ({ row }) => renderComponent(StatusBadge, { status: row.original.status })
		},
		{
			accessorKey: 'error',
			header: 'Error',
			cell: ({ row }) => row.original.error ?? '—'
		}
	];
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
			{#if viewState.kind !== 'ready'}
				<ResourceStateBanner state={viewState} onReload={onReload} />
			{/if}

			<PageHeader
				breadcrumb="Comms / Campaigns"
				title={campaign.name}
				status={statusLabel}
				description={campaign.last_error ? `Last error: ${campaign.last_error}` : undefined}
			>
				{#snippet actions()}
					{#if onBack}
						<Button type="button" variant="outline" size="sm" onclick={onBack}>Back</Button>
					{/if}
					{#if onReload}
						<Button type="button" variant="outline" size="sm" disabled={busy} onclick={onReload}>
							Refresh
						</Button>
					{/if}
					{#if canCancel && onCancel}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onclick={() => void onCancel?.()}
						>
							Cancel campaign
						</Button>
					{/if}
				{/snippet}
			</PageHeader>

			<dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-lg border p-4">
					<dt class="text-muted-foreground text-sm">Pending</dt>
					<dd class="text-2xl font-semibold">{campaign.recipient_counts.pending}</dd>
				</div>
				<div class="rounded-lg border p-4">
					<dt class="text-muted-foreground text-sm">Sent</dt>
					<dd class="text-2xl font-semibold">{campaign.recipient_counts.sent}</dd>
				</div>
				<div class="rounded-lg border p-4">
					<dt class="text-muted-foreground text-sm">Failed</dt>
					<dd class="text-2xl font-semibold">{campaign.recipient_counts.failed}</dd>
				</div>
				<div class="rounded-lg border p-4">
					<dt class="text-muted-foreground text-sm">Quota remaining</dt>
					<dd class="text-2xl font-semibold">
						{campaign.quota_remaining ?? '—'}
					</dd>
				</div>
			</dl>

			<div class="space-y-3">
				<h2 class="text-sm font-medium">Recipients</h2>
				<DataTableShell
					columns={recipientColumns}
					data={recipients}
					filterColumn="to_email"
					filterPlaceholder="Filter recipients…"
					emptyMessage="No recipients yet."
					pageSize={25}
				/>
			</div>
		</div>
	</main>
</AppSidebarFrame>
