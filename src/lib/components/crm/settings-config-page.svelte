<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		MembershipRole,
		OrganisationConfigData,
		OrganisationConfigResource,
		ProfilePreferencesData,
		TaxRateFormData,
		TaxRateResource
	} from '$lib/schemas/organisation.js';
	import { canMutateOrgConfig, roleLabel } from '$lib/schemas/organisation.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import OrganisationConfigForm from './organisation-config-form.svelte';
	import ProfilePreferencesForm from './profile-preferences-form.svelte';
	import TaxRateForm from './tax-rate-form.svelte';
	import StatusBadge from './status-badge.svelte';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface SettingsConfigPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role: MembershipRole;
		configuration: OrganisationConfigResource | null;
		taxRates: TaxRateResource[];
		configForm: SuperForm<OrganisationConfigData>;
		preferencesForm: SuperForm<ProfilePreferencesData>;
		taxRateForm: SuperForm<TaxRateFormData>;
		taxDrawerOpen?: boolean;
		editingTaxRateId?: string | null;
		viewState?: ResourceViewState;
		class?: string;
		onReload?: () => void;
		onSaveConfig?: () => boolean | void | Promise<boolean | void>;
		onSavePreferences?: () => boolean | void | Promise<boolean | void>;
		/**
		 * Return `false` (or reject) to keep the tax drawer open after a failed save.
		 */
		onSaveTaxRate?: () => boolean | void | Promise<boolean | void>;
		onSetDefaultTaxRate?: (taxRateId: string) => void;
		onArchiveTaxRate?: (taxRateId: string) => void;
		onEditTaxRate?: (taxRateId: string) => void;
		onAddTaxRate?: () => void;
	}

	let {
		orgName,
		navGroups,
		role,
		configuration,
		taxRates,
		configForm,
		preferencesForm,
		taxRateForm,
		taxDrawerOpen = $bindable(false),
		editingTaxRateId = null,
		viewState = { kind: 'ready' },
		class: className,
		onReload,
		onSaveConfig,
		onSavePreferences,
		onSaveTaxRate,
		onSetDefaultTaxRate,
		onArchiveTaxRate,
		onEditTaxRate,
		onAddTaxRate
	}: SettingsConfigPageProps = $props();

	const canEdit = $derived(canMutateOrgConfig(role));
	const showContent = $derived(
		viewState.kind === 'ready' || viewState.kind === 'empty' || viewState.kind === 'conflict'
	);

	let taxSaveError = $state<string | null>(null);

	async function handleTaxSave(): Promise<boolean> {
		taxSaveError = null;
		try {
			const result = await onSaveTaxRate?.();
			if (result === false) {
				taxSaveError = 'Could not save tax rate — try again.';
				return false;
			}
			taxDrawerOpen = false;
			return true;
		} catch (err) {
			taxSaveError =
				err instanceof Error ? err.message : 'Could not save tax rate — try again.';
			return false;
		}
	}
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-svh', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0 self-stretch" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-8 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Organisation · Settings"
				title="Config"
				description="Organisation defaults, named tax rates, and your personal theme override."
			>
				{#snippet actions()}
					<span class="text-muted-foreground text-xs">Your role: {roleLabel(role)}</span>
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if showContent && configuration}
				<section class="space-y-4" data-testid="org-defaults-section">
					<div>
						<h2 class="text-lg font-semibold tracking-tight">Organisation defaults</h2>
						<p class="text-muted-foreground text-sm">
							Timezone, currency, locale, and the org theme default.
							{#if !canEdit}
								Read-only for your role.
							{/if}
						</p>
					</div>
					<OrganisationConfigForm
						form={configForm}
						readonly={!canEdit}
						onValidSubmit={onSaveConfig}
					/>
				</section>

				<section class="space-y-4" data-testid="tax-rates-section">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="text-lg font-semibold tracking-tight">Tax rates</h2>
							<p class="text-muted-foreground text-sm">
								Named rates with at most one active default.
							</p>
						</div>
						{#if canEdit}
							<Button
								type="button"
								size="sm"
								data-testid="tax-rate-add"
								onclick={() => {
									taxSaveError = null;
									onAddTaxRate?.();
								}}
							>
								Add tax rate
							</Button>
						{/if}
					</div>

					{#if taxRates.length === 0}
						<p
							class="text-muted-foreground rounded-3xl border border-dashed px-4 py-10 text-center text-sm"
							data-testid="tax-rates-empty"
						>
							No tax rates yet.
						</p>
					{:else}
						<ul class="divide-border divide-y rounded-3xl border" data-testid="tax-rates-list">
							{#each taxRates as rate (rate.id)}
								<li
									class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
									data-testid={`tax-rate-row-${rate.id}`}
								>
									<div class="min-w-0 space-y-1">
										<div class="flex flex-wrap items-center gap-2">
											<p class="truncate font-medium">{rate.name}</p>
											{#if rate.is_default}
												<StatusBadge status="Default" />
											{/if}
											{#if !rate.active}
												<StatusBadge status="Archived" />
											{/if}
										</div>
										<p class="text-muted-foreground text-sm">{rate.rate_percent}%</p>
									</div>
									{#if canEdit}
										<div class="flex flex-wrap gap-2">
											{#if rate.active && !rate.is_default}
												<Button
													type="button"
													size="sm"
													variant="outline"
													data-testid={`tax-rate-set-default-${rate.id}`}
													onclick={() => onSetDefaultTaxRate?.(rate.id)}
												>
													Set default
												</Button>
											{/if}
											<Button
												type="button"
												size="sm"
												variant="outline"
												data-testid={`tax-rate-edit-${rate.id}`}
												onclick={() => {
													taxSaveError = null;
													onEditTaxRate?.(rate.id);
												}}
											>
												Edit
											</Button>
											{#if rate.active && !rate.is_default}
												<Button
													type="button"
													size="sm"
													variant="ghost"
													data-testid={`tax-rate-archive-${rate.id}`}
													onclick={() => onArchiveTaxRate?.(rate.id)}
												>
													Archive
												</Button>
											{/if}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section class="space-y-4" data-testid="personal-theme-section">
					<div>
						<h2 class="text-lg font-semibold tracking-tight">Personal theme</h2>
						<p class="text-muted-foreground text-sm">
							Optional override that applies across every organisation you belong to.
						</p>
					</div>
					<ProfilePreferencesForm
						form={preferencesForm}
						onValidSubmit={onSavePreferences}
					/>
				</section>
			{:else if showContent && !configuration && viewState.kind === 'ready'}
				<p class="text-muted-foreground text-sm">Configuration unavailable.</p>
			{/if}
		</div>
	</main>
</div>

{#if canEdit}
	<Drawer.Root bind:open={taxDrawerOpen} direction="right" shouldScaleBackground={false}>
		<Drawer.Content class="mx-auto w-full max-w-md" data-testid="tax-rate-drawer">
			<Drawer.Header class="text-left">
				<Drawer.Title>{editingTaxRateId ? 'Edit tax rate' : 'Add tax rate'}</Drawer.Title>
				<Drawer.Description>
					Setting a rate as default clears the previous active default.
				</Drawer.Description>
			</Drawer.Header>
			<div class="space-y-3 px-4 pb-6">
				{#if taxSaveError}
					<p class="text-destructive text-sm" role="alert" data-testid="tax-rate-save-error">
						{taxSaveError}
					</p>
				{/if}
				<TaxRateForm form={taxRateForm} onValidSubmit={handleTaxSave} />
			</div>
		</Drawer.Content>
	</Drawer.Root>
{/if}
