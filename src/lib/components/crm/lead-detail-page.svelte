<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ConvertLeadFormData, LeadFormData, LeadResource } from '$lib/schemas/lead.js';
	import type { ClientResource } from '$lib/schemas/client.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import LeadForm from './lead-form.svelte';
	import ConvertLeadDialog from './convert-lead-dialog.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import StatusBadge from './status-badge.svelte';
	import InfoCard from './info-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface LeadConvertResult {
		lead: LeadResource;
		client: ClientResource;
		idempotent: boolean;
	}

	export interface LeadDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		lead?: LeadResource | null;
		leadForm: SuperForm<LeadFormData>;
		convertForm: SuperForm<ConvertLeadFormData>;
		viewState?: ResourceViewState;
		convertOpen?: boolean;
		converting?: boolean;
		lastConvertResult?: LeadConvertResult | null;
		class?: string;
		onSave?: () => void;
		onConvert?: () => void;
		onOpenClient?: (clientId: string) => void;
		onReload?: () => void;
	}

	let {
		orgName,
		navGroups,
		lead = null,
		leadForm,
		convertForm,
		viewState = { kind: 'ready' },
		convertOpen = $bindable(false),
		converting = false,
		lastConvertResult = null,
		class: className,
		onSave,
		onConvert,
		onOpenClient,
		onReload
	}: LeadDetailPageProps = $props();

	const isWon = $derived(lead?.stage === 'won');
	const title = $derived(lead?.name ?? 'Lead');
	const statusLabel = $derived(
		lead?.stage ? lead.stage.charAt(0).toUpperCase() + lead.stage.slice(1) : '—'
	);
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Leads"
				{title}
				status={statusLabel}
				description={lead
					? `version ${lead.version}${lead.company_name ? ` · ${lead.company_name}` : ''}`
					: 'Lead workspace'}
			>
				{#snippet actions()}
					{#if lead && !isWon}
						<Button
							type="button"
							size="sm"
							onclick={() => (convertOpen = true)}
							data-testid="open-convert"
						>
							Convert lead
						</Button>
					{/if}
					{#if lead?.client_id}
						<Button
							type="button"
							size="sm"
							variant="outline"
							onclick={() => lead?.client_id && onOpenClient?.(lead.client_id)}
						>
							Open client
						</Button>
					{/if}
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if lastConvertResult}
				<div
					class="rounded-3xl bg-emerald-500/10 px-4 py-3 text-sm ring-1 ring-emerald-500/30"
					data-testid="convert-result"
				>
					<p class="font-medium">
						{lastConvertResult.idempotent
							? 'Already converted — showing existing client.'
							: 'Lead converted to client.'}
					</p>
					<p class="text-muted-foreground mt-1 text-xs">
						Client {lastConvertResult.client.name} ·
						<button
							type="button"
							class="text-foreground underline underline-offset-2"
							onclick={() => onOpenClient?.(lastConvertResult!.client.id)}
						>
							Open client
						</button>
					</p>
				</div>
			{/if}

			{#if lead && viewState.kind === 'ready'}
				<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
					<section
						class="bg-card space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold tracking-tight">Details</h2>
							{#if isWon}
								<StatusBadge status="Converted" />
							{/if}
						</div>
						{#if isWon}
							<p class="text-muted-foreground text-sm">
								Converted leads are read-only here — edit the client instead.
							</p>
							<InfoCard
								title="Snapshot"
								fields={[
									{ label: 'Name', value: lead.name },
									{ label: 'Company', value: lead.company_name ?? '—' },
									{
										label: 'Value',
										value:
											lead.value_cents != null
												? `${lead.currency} ${(lead.value_cents / 100).toLocaleString()}`
												: '—'
									},
									{ label: 'Converted at', value: lead.converted_at ?? '—' },
									{ label: 'Client id', value: lead.client_id ?? '—' }
								]}
							/>
						{:else}
							<LeadForm
								form={leadForm}
								submitLabel="Save lead"
								onValidSubmit={() => onSave?.()}
							/>
						{/if}
					</section>

					<section class="space-y-4">
						<InfoCard
							title="Lifecycle"
							fields={[
								{ label: 'Stage', value: lead.stage },
								{ label: 'ETag version', value: String(lead.version) },
								{ label: 'Lost reason', value: lead.lost_reason ?? '—' },
								{ label: 'Lost at', value: lead.lost_at ?? '—' },
								{ label: 'Won at', value: lead.won_at ?? '—' }
							]}
						/>
					</section>
				</div>
			{/if}
		</div>
	</main>
</div>

{#if lead}
	<ConvertLeadDialog
		bind:open={convertOpen}
		form={convertForm}
		leadName={lead.name}
		busy={converting}
		onConfirm={() => onConvert?.()}
	/>
{/if}
