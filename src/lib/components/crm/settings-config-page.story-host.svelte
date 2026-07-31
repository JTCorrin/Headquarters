<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		organisationConfigSchema,
		profilePreferencesSchema,
		taxRateFormSchema,
		type MembershipRole,
		type OrganisationConfigResource,
		type TaxRateResource
	} from '$lib/schemas/organisation.js';
	import SettingsConfigPage from './settings-config-page.svelte';
	import type { AppNavGroup } from './app-nav.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';

	export interface SettingsConfigPageStoryHostProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role?: MembershipRole;
		configuration?: OrganisationConfigResource | null;
		taxRates?: TaxRateResource[];
		viewState?: ResourceViewState;
		class?: string;
		onReload?: () => void;
		onSaveConfig?: () => void;
		onSavePreferences?: () => void;
		onSaveTaxRate?: () => void;
		onSetDefaultTaxRate?: (taxRateId: string) => void;
		onArchiveTaxRate?: (taxRateId: string) => void;
	}

	let {
		orgName,
		navGroups,
		role = 'owner',
		configuration = null,
		taxRates = [],
		viewState = { kind: 'ready' },
		class: className,
		onReload,
		onSaveConfig,
		onSavePreferences,
		onSaveTaxRate,
		onSetDefaultTaxRate,
		onArchiveTaxRate
	}: SettingsConfigPageStoryHostProps = $props();

	let taxDrawerOpen = $state(false);
	let editingTaxRateId = $state<string | null>(null);
	let rates = $state<TaxRateResource[]>([...taxRates]);

	$effect(() => {
		rates = [...taxRates];
	});

	const configForm = superForm(
		defaults(
			{
				timezone: configuration?.timezone ?? 'Europe/London',
				currency: configuration?.default_currency ?? 'GBP',
				locale: configuration?.locale ?? 'en-GB',
				themeDefault: configuration?.theme_default ?? 'system'
			},
			zod4(organisationConfigSchema)
		),
		{
			validators: zod4(organisationConfigSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const preferencesForm = superForm(
		defaults({ themePreference: 'org_default' }, zod4(profilePreferencesSchema)),
		{
			validators: zod4(profilePreferencesSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const taxRateForm = superForm(
		defaults(
			{
				name: '',
				ratePercent: '20',
				isDefault: 'false',
				active: 'true'
			},
			zod4(taxRateFormSchema)
		),
		{
			validators: zod4(taxRateFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	function onAddTaxRate() {
		editingTaxRateId = null;
		taxRateForm.form.update((current) => ({
			...current,
			name: '',
			ratePercent: '20',
			isDefault: 'false',
			active: 'true'
		}));
		taxDrawerOpen = true;
	}

	function onEditTaxRate(taxRateId: string) {
		const rate = rates.find((r) => r.id === taxRateId);
		if (!rate) return;
		editingTaxRateId = taxRateId;
		taxRateForm.form.update((current) => ({
			...current,
			name: rate.name,
			ratePercent: String(rate.rate_percent),
			isDefault: rate.is_default ? 'true' : 'false',
			active: rate.active ? 'true' : 'false'
		}));
		taxDrawerOpen = true;
	}

	function handleSetDefault(taxRateId: string) {
		rates = rates.map((rate) => ({
			...rate,
			is_default: rate.id === taxRateId
		}));
		onSetDefaultTaxRate?.(taxRateId);
	}
</script>

<SettingsConfigPage
	{orgName}
	{navGroups}
	{role}
	{configuration}
	taxRates={rates}
	{configForm}
	{preferencesForm}
	{taxRateForm}
	bind:taxDrawerOpen
	{editingTaxRateId}
	{viewState}
	{onReload}
	{onSaveConfig}
	{onSavePreferences}
	{onSaveTaxRate}
	onSetDefaultTaxRate={handleSetDefault}
	{onArchiveTaxRate}
	{onEditTaxRate}
	{onAddTaxRate}
	class={className}
/>
