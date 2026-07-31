<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		themePreferenceToApi,
		toOrganisationConfigFormData,
		toOrganisationConfigPatch,
		toOrganisationConfigResource,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toProfilePreferencesFormData,
		toTaxRateCreateBody,
		toTaxRateResource
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		organisationConfigSchema,
		profilePreferencesSchema,
		taxRateFormSchema,
		type MembershipRole,
		type OrganisationConfigResource,
		type OrganisationCreateData,
		type TaxRateResource
	} from '$lib/schemas/organisation.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import SettingsConfigPage from './settings-config-page.svelte';

	export interface OrgConfigPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		class?: string;
	}

	let { api, session, onMissingOrg, onSwitchNavigate, class: className }: OrgConfigPageProps =
		$props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let configuration = $state<OrganisationConfigResource | null>(null);
	let taxRates = $state<TaxRateResource[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let taxDrawerOpen = $state(false);
	let editingTaxRateId = $state<string | null>(null);

	const configForm = superForm(
		defaults(
			{
				timezone: 'UTC',
				currency: 'GBP',
				locale: 'en-GB',
				themeDefault: 'system' as const
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
		defaults({ themePreference: 'org_default' as const }, zod4(profilePreferencesSchema)),
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

	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('Config'));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isPreconditionFailed) {
				return 'This record changed elsewhere — reload and try again.';
			}
			if (error.isValidationError) {
				if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
				return error.message;
			}
			return error.message || fallback;
		}
		return fallback;
	}

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
	}

	/**
	 * Plain mirror of session identity for post-await stale checks.
	 * Reading `$state` after `await` can observe a pre-await snapshot in Svelte 5;
	 * this object is updated synchronously in an effect and is safe after suspension.
	 */
	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
	});

	function captureEpoch(): RequestEpoch {
		return { orgId: liveEpoch.orgId, generation: liveEpoch.generation };
	}

	function isStale(epoch: RequestEpoch): boolean {
		return epoch.orgId !== liveEpoch.orgId || epoch.generation !== liveEpoch.generation;
	}

	function resetOrgScopedState() {
		configuration = null;
		taxRates = [];
		taxDrawerOpen = false;
		editingTaxRateId = null;
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening configuration.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			if (session.memberships.length === 0) {
				const rows = await api.listOrganisations();
				if (isStale(epoch)) return;
				session.setMemberships(rows.map(toOrgMembershipSummary));
			}

			const [config, rates, prefs] = await Promise.all([
				api.getOrganisationConfiguration(),
				api.listTaxRates(),
				api.getProfilePreferences()
			]);

			if (isStale(epoch)) return;

			configuration = toOrganisationConfigResource(config);
			taxRates = rates.map(toTaxRateResource);
			configForm.form.set(toOrganisationConfigFormData(config));
			preferencesForm.form.set(toProfilePreferencesFormData(prefs));
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			if (isApiClientError(error) && error.isValidationError) {
				viewState = {
					kind: 'validation',
					message: userMessage(error, 'Validation failed'),
					fields: error.fields
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load configuration.')
			};
		}
	}

	async function onSaveConfig() {
		if (!configuration) return;
		const epoch = captureEpoch();
		const version = configuration.version;
		try {
			const updated = await api.patchOrganisationConfiguration(
				toOrganisationConfigPatch(get(configForm.form)),
				version
			);
			if (isStale(epoch)) {
				// Superforms may reapply submitted values after onUpdate; resync live org.
				void loadAll();
				return false;
			}
			configuration = toOrganisationConfigResource(updated);
			configForm.form.set(toOrganisationConfigFormData(updated));
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Configuration is out of date.')
				};
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			if (isApiClientError(error) && error.isValidationError) {
				viewState = {
					kind: 'validation',
					message: userMessage(error, 'Validation failed'),
					fields: error.fields
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save configuration.')
			};
		}
	}

	async function onSavePreferences() {
		const epoch = captureEpoch();
		try {
			const values = get(preferencesForm.form);
			const updated = await api.patchProfilePreferences({
				theme_preference: themePreferenceToApi(values.themePreference)
			});
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			preferencesForm.form.set(toProfilePreferencesFormData(updated));
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			if (isApiClientError(error) && error.isValidationError) {
				viewState = {
					kind: 'validation',
					message: userMessage(error, 'Validation failed'),
					fields: error.fields
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save preferences.')
			};
		}
	}

	async function onSaveTaxRate(): Promise<boolean> {
		const epoch = captureEpoch();
		const values = get(taxRateForm.form);
		const body = toTaxRateCreateBody(values);
		const editingId = editingTaxRateId;
		try {
			if (editingId) {
				const current = taxRates.find((r) => r.id === editingId);
				if (!current) return false;
				const updated = await api.patchTaxRate(editingId, body, current.version);
				if (isStale(epoch)) return false;
				taxRates = taxRates.map((r) =>
					r.id === updated.id ? toTaxRateResource(updated) : r
				);
			} else {
				const created = await api.createTaxRate(body);
				if (isStale(epoch)) return false;
				taxRates = [toTaxRateResource(created), ...taxRates];
			}
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Tax rate is out of date.')
				};
			}
			throw new Error(userMessage(error, 'Could not save tax rate — try again.'));
		}
	}

	async function onSetDefaultTaxRate(taxRateId: string) {
		const current = taxRates.find((r) => r.id === taxRateId);
		if (!current || current.is_default) return;
		const epoch = captureEpoch();
		const version = current.version;
		try {
			const updated = await api.patchTaxRate(taxRateId, { is_default: true }, version);
			if (isStale(epoch)) return;
			taxRates = taxRates.map((rate) => {
				if (rate.id === updated.id) return toTaxRateResource(updated);
				return { ...rate, is_default: false };
			});
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not set default tax rate.')
			};
		}
	}

	async function onArchiveTaxRate(taxRateId: string) {
		const current = taxRates.find((r) => r.id === taxRateId);
		if (!current) return;
		const epoch = captureEpoch();
		const version = current.version;
		try {
			await api.deleteTaxRate(taxRateId, version);
			if (isStale(epoch)) return;
			taxRates = taxRates.filter((r) => r.id !== taxRateId);
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not archive tax rate.')
			};
		}
	}

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
		const rate = taxRates.find((r) => r.id === taxRateId);
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

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		resetOrgScopedState();
		session.selectOrg(orgId);
		onSwitchNavigate?.(orgId);
		busy = false;
	}

	async function onValidCreate(data: OrganisationCreateData): Promise<boolean> {
		createError = null;
		try {
			const result = await api.createOrganisation(toOrganisationCreateBody(data));
			const membership = membershipFromCreateResult(result);
			session.setMemberships([...session.memberships, membership]);
			resetOrgScopedState();
			session.selectOrg(membership.org_id);
			onSwitchNavigate?.(membership.org_id);
			return true;
		} catch (error) {
			createError = userMessage(error, 'Could not create organisation — try again.');
			return false;
		}
	}

	$effect(() => {
		// Re-load when selection or cache generation changes (switch resets caches).
		void session.selectedOrgId;
		void session.cacheGeneration;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="org-config-page">
		<AppShell
			{currentOrgId}
			memberships={session.memberships}
			{switchError}
			{busy}
			{createError}
			{onSwitchOrg}
			{onValidCreate}
		>
			<SettingsConfigPage
				{orgName}
				{navGroups}
				{role}
				{configuration}
				{taxRates}
				{configForm}
				{preferencesForm}
				{taxRateForm}
				bind:taxDrawerOpen
				{editingTaxRateId}
				{viewState}
				onReload={loadAll}
				{onSaveConfig}
				{onSavePreferences}
				{onSaveTaxRate}
				{onSetDefaultTaxRate}
				{onArchiveTaxRate}
				{onEditTaxRate}
				{onAddTaxRate}
			/>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="org-config-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening configuration.
		</p>
	</div>
{/if}
