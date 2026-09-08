<script lang="ts">
	import type { ApiCampaign, ApiCampaignRecipient, ApiCampaignEvent } from '$lib/api/v1/types.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import DataTableShell from './data-table-shell.svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { renderComponent } from '$lib/components/ui/data-table/index.js';
	import StatusBadge from './status-badge.svelte';
	import DataTableSortHeader from './data-table-sort-header.svelte';
	import ResourceStateBanner, { type ResourceViewState } from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface CampaignDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		campaign: ApiCampaign;
		recipients: ApiCampaignRecipient[];
		activity?: ApiCampaignEvent[];
		activityError?: string | null;
		viewState?: ResourceViewState;
		busy?: boolean;
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onBack?: () => void;
		onCancel?: () => void | Promise<void>;
		onResend?: () => void | Promise<void>;
	}

	let {
		orgName,
		navGroups,
		campaign,
		recipients,
		activity = [],
		activityError = null,
		viewState = { kind: 'ready' },
		busy = false,
		showNav = true,
		class: className,
		onReload,
		onBack,
		onCancel,
		onResend
	}: CampaignDetailPageProps = $props();

	const statusLabel = $derived(campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1));

	const canCancel = $derived(campaign.status === 'scheduled' || campaign.status === 'sending');
	const canResend = $derived(['completed', 'failed', 'cancelled'].includes(campaign.status));
	let confirmResend = $state(false);
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 10000);
		return () => clearInterval(timer);
	});
	const isPaused = $derived(
		Boolean(campaign.next_attempt_at && Date.parse(campaign.next_attempt_at) > now)
	);
	const stalled = $derived(
		campaign.status === 'sending' &&
			!isPaused &&
			now - Date.parse(campaign.last_worker_at ?? campaign.started_at ?? campaign.created_at) >
				180000
	);
	function when(value: string | null | undefined) {
		return value ? new Date(value).toLocaleString() : 'Not yet';
	}

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
	class={cn(showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col', className)}
>
	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
			{#if viewState.kind !== 'ready'}
				<ResourceStateBanner state={viewState} {onReload} />
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
					{#if canResend && onResend}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onclick={() => {
								confirmResend = true;
							}}>Resend campaign</Button
						>
					{/if}
				{/snippet}
			</PageHeader>

			{#if confirmResend && canResend && onResend}
				<div class="space-y-3 rounded-lg border p-4" role="region" aria-label="Prepare resend">
					<p class="font-medium">Prepare a new campaign draft?</p>
					<p class="text-sm text-muted-foreground">
						This copies the template, mailbox and audience filters. Previously contacted people may
						be included. Review the current audience in the new draft, then launch it when ready.
						This action sends no emails.
					</p>
					<div class="flex gap-2">
						<Button disabled={busy} onclick={() => void onResend?.()}>Create resend draft</Button>
						<Button
							variant="outline"
							disabled={busy}
							onclick={() => {
								confirmResend = false;
							}}>Keep original</Button
						>
					</div>
				</div>
			{/if}
			{#if stalled}
				<p role="status" class="rounded-lg border p-4 text-sm">
					Sending appears delayed: the worker has not checked this campaign recently. Your pending
					recipients are still queued. Contact support if this continues; launching another campaign
					may send duplicates.
				</p>
			{:else if campaign.status === 'sending' && isPaused}
				<p role="status" class="rounded-lg border p-4 text-sm">
					Sending is paused until {when(campaign.next_attempt_at)}. Pending recipients will resume
					automatically.
				</p>
			{:else if campaign.status === 'sending'}
				<p role="status" class="text-sm text-muted-foreground">
					Recipients are queued or being sent in batches. Progress refreshes automatically every 10
					seconds.
				</p>
			{/if}

			<dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-lg border p-4">
					<dt class="text-sm text-muted-foreground">Pending</dt>
					<dd class="text-2xl font-semibold">{campaign.recipient_counts.pending}</dd>
				</div>
				<div class="rounded-lg border p-4">
					<dt class="text-sm text-muted-foreground">Sent</dt>
					<dd class="text-2xl font-semibold">{campaign.recipient_counts.sent}</dd>
				</div>
				<div class="rounded-lg border p-4">
					<dt class="text-sm text-muted-foreground">Failed</dt>
					<dd class="text-2xl font-semibold">{campaign.recipient_counts.failed}</dd>
				</div>
				<div class="rounded-lg border p-4">
					<dt class="text-sm text-muted-foreground">Quota remaining</dt>
					<dd class="text-2xl font-semibold">
						{campaign.quota_remaining ?? '—'}
					</dd>
				</div>
			</dl>

			<section class="space-y-3" aria-label="Campaign activity">
				<h2 class="text-sm font-medium">Campaign activity</h2>
				<dl class="grid gap-3 text-sm sm:grid-cols-2">
					<div>
						<dt class="text-muted-foreground">Queued / scheduled</dt>
						<dd>{when(campaign.scheduled_at)}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Last worker check</dt>
						<dd>{when(campaign.last_worker_at)}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Finished</dt>
						<dd>{when(campaign.completed_at)}</dd>
					</div>
				</dl>
				{#if activityError}<p role="alert" class="text-sm text-destructive">{activityError}</p>{/if}
				{#if activity.length}
					<ol class="max-h-80 space-y-3 overflow-y-auto rounded-lg border p-4 text-sm">
						{#each activity as event (event.id)}
							<li>
								<time datetime={event.created_at} class="text-muted-foreground"
									>{when(event.created_at)}</time
								><span class="ml-2 font-medium">{event.level}</span>
								<p class="mt-1 break-words">{event.message}</p>
							</li>
						{/each}
					</ol>
					<p class="text-xs text-muted-foreground">
						Latest 100 events. “Sent” means accepted by the mail server, not confirmed inbox
						delivery.
					</p>
				{:else if !activityError}
					<p class="text-sm text-muted-foreground">
						No recorded activity yet. Older campaigns may only have recipient results.
					</p>
				{/if}
			</section>

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
