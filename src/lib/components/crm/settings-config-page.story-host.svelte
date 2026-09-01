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
	import {
		emptyMailboxFormData,
		mailboxFormSchema,
		type MailboxAccountResource,
		type MailboxTestFeedback
	} from '$lib/schemas/mailbox.js';
	import SettingsConfigPage from './settings-config-page.svelte';
	import type { AppNavGroup } from './app-nav.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';

	export interface SettingsConfigPageStoryHostProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role?: MembershipRole;
		configuration?: OrganisationConfigResource | null;
		taxRates?: TaxRateResource[];
		mailboxAccount?: MailboxAccountResource | null;
		includeMailbox?: boolean;
		viewState?: ResourceViewState;
		/** Simulate resolved `false` from tax save. */
		failTaxSave?: boolean;
		/** Simulate rejected tax save. */
		rejectTaxSave?: boolean;
		/** Artificial tax-save latency in ms. */
		taxSaveDelayMs?: number;
		class?: string;
		onReload?: () => void;
		onSaveConfig?: () => boolean | void | Promise<boolean | void>;
		onSavePreferences?: () => boolean | void | Promise<boolean | void>;
		onSaveMailbox?: () => boolean | void | Promise<boolean | void>;
		onTestMailbox?: () =>
			| MailboxTestFeedback
			| false
			| void
			| Promise<MailboxTestFeedback | false | void>;
		onDisconnectMailbox?: () => boolean | void | Promise<boolean | void>;
		onSaveTaxRate?: () => boolean | void | Promise<boolean | void>;
		onSetDefaultTaxRate?: (taxRateId: string) => void;
		onArchiveTaxRate?: (taxRateId: string) => void;
	}

	let {
		orgName,
		navGroups,
		role = 'owner',
		configuration = null,
		taxRates = [],
		mailboxAccount = null,
		includeMailbox = false,
		viewState = { kind: 'ready' },
		failTaxSave = false,
		rejectTaxSave = false,
		taxSaveDelayMs = 0,
		class: className,
		onReload,
		onSaveConfig,
		onSavePreferences,
		onSaveMailbox,
		onTestMailbox,
		onDisconnectMailbox,
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

	const mailboxForm = superForm(defaults(emptyMailboxFormData('gmail'), zod4(mailboxFormSchema)), {
		validators: zod4(mailboxFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

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

	async function handleSaveTaxRate(): Promise<boolean> {
		if (taxSaveDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, taxSaveDelayMs));
		}
		if (rejectTaxSave) {
			throw new Error('Could not save tax rate — try again.');
		}
		if (failTaxSave) {
			return false;
		}
		const result = await onSaveTaxRate?.();
		return result === false ? false : true;
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
	mailboxForm={includeMailbox ? mailboxForm : undefined}
	{mailboxAccount}
	bind:taxDrawerOpen
	{editingTaxRateId}
	{viewState}
	{onReload}
	{onSaveConfig}
	{onSavePreferences}
	{onSaveMailbox}
	{onTestMailbox}
	{onDisconnectMailbox}
	onSaveTaxRate={handleSaveTaxRate}
	onSetDefaultTaxRate={handleSetDefault}
	{onArchiveTaxRate}
	{onEditTaxRate}
	{onAddTaxRate}
	class={className}
/>
