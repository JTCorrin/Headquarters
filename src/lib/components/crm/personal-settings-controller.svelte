<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		themePreferenceFromApi,
		themePreferenceToApi,
		toMailboxAccountResource,
		toMailboxPutBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toProfilePreferencesFormData
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		canAccessPersonalConfig,
		profilePreferencesSchema,
		type MembershipRole,
		type OrganisationCreateData
	} from '$lib/schemas/organisation.js';
	import {
		emptyMailboxFormData,
		mailboxFormFromResource,
		mailboxFormSchema,
		type MailboxAccountResource
	} from '$lib/schemas/mailbox.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import PersonalSettingsPage from './personal-settings-page.svelte';

	export interface PersonalSettingsControllerProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: PersonalSettingsControllerProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let mailboxAccount = $state<MailboxAccountResource | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

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

	const mailboxForm = superForm(defaults(emptyMailboxFormData('gmail'), zod4(mailboxFormSchema)), {
		validators: zod4(mailboxFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('My settings', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isValidationError) {
				if (error.fields) {
					const keyed = Object.entries(error.fields)
						.map(([field, message]) => `${field}: ${message}`)
						.join(' · ');
					return keyed || error.message;
				}
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

	const liveEpoch: RequestEpoch = { orgId: null, generation: -1 };

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

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening settings.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			if (session.memberships.length === 0) {
				const rows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(rows.map(toOrgMembershipSummary));
			}

			const currentRole = (roleFromMemberships(session.memberships, session.selectedOrgId) ??
				'member') as MembershipRole;
			if (!canAccessPersonalConfig(currentRole)) {
				viewState = {
					kind: 'forbidden',
					message: 'Personal settings are not available for billing-only memberships.'
				};
				return;
			}

			const prefs = await api.profilePreferences.get();
			if (isStale(epoch)) return;
			preferencesForm.form.set(toProfilePreferencesFormData(prefs));
			session.setThemePreference(themePreferenceFromApi(prefs.theme_preference));

			try {
				const account = await api.mailbox.get();
				if (isStale(epoch)) return;
				mailboxAccount = toMailboxAccountResource(account);
				mailboxForm.form.set(
					mailboxAccount
						? mailboxFormFromResource(mailboxAccount)
						: emptyMailboxFormData('gmail')
				);
			} catch (error) {
				if (isStale(epoch)) return;
				mailboxAccount = null;
				mailboxForm.form.set(emptyMailboxFormData('gmail'));
				if (
					!(
						isApiClientError(error) &&
						(error.status === 404 || error.code === 'NOT_FOUND')
					)
				) {
					// Non-fatal — still show prefs.
				}
			}

			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load settings.')
			};
		}
	}

	async function onSavePreferences() {
		const epoch = captureEpoch();
		try {
			const values = get(preferencesForm.form);
			const updated = await api.profilePreferences.update({
				theme_preference: themePreferenceToApi(values.themePreference)
			});
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			preferencesForm.form.set(toProfilePreferencesFormData(updated));
			session.setThemePreference(themePreferenceFromApi(updated.theme_preference));
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save preferences.')
			};
			return false;
		}
	}

	async function onSaveMailbox() {
		const epoch = captureEpoch();
		try {
			const updated = await api.mailbox.put(toMailboxPutBody(get(mailboxForm.form)));
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			mailboxAccount = toMailboxAccountResource(updated);
			mailboxForm.form.set(
				mailboxAccount ? mailboxFormFromResource(mailboxAccount) : emptyMailboxFormData('gmail')
			);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save mailbox.')
			};
			return false;
		}
	}

	async function onTestMailbox() {
		const epoch = captureEpoch();
		try {
			const result = await api.mailbox.test();
			if (isStale(epoch)) return false;
			if (!result.ok) {
				viewState = {
					kind: 'validation',
					message: result.message || result.error_code || 'Mailbox test failed.'
				};
				return false;
			}
			void loadAll();
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Mailbox test failed.')
			};
			return false;
		}
	}

	async function onDisconnectMailbox() {
		const epoch = captureEpoch();
		try {
			await api.mailbox.disconnect();
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			mailboxAccount = null;
			mailboxForm.form.set(emptyMailboxFormData('gmail'));
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not disconnect mailbox.')
			};
			return false;
		}
	}

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		viewState = { kind: 'loading' };
		session.selectOrg(orgId);
		onSwitchNavigate?.(orgId);
		busy = false;
	}

	async function onValidCreate(data: OrganisationCreateData): Promise<boolean> {
		createError = null;
		try {
			const result = await api.organisations.create(toOrganisationCreateBody(data));
			const membership = membershipFromCreateResult(result);
			session.setMemberships([...session.memberships, membership]);
			session.selectOrg(membership.org_id);
			onSwitchNavigate?.(membership.org_id);
			return true;
		} catch (error) {
			createError = userMessage(error, 'Could not create organisation — try again.');
			return false;
		}
	}

	$effect(() => {
		void session.selectedOrgId;
		void session.cacheGeneration;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="personal-settings-controller">
		<AppShell
			{currentOrgId}
			memberships={session.memberships}
			{orgName}
			{navGroups}
			{switchError}
			{busy}
			{createError}
			{onSwitchOrg}
			{onLogout}
			{onValidCreate}
		>
			<PersonalSettingsPage
				{orgName}
				{navGroups}
				{role}
				{preferencesForm}
				{mailboxForm}
				{mailboxAccount}
				{viewState}
				onReload={loadAll}
				{onSavePreferences}
				{onSaveMailbox}
				{onTestMailbox}
				{onDisconnectMailbox}
				showNav={false}
			/>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="personal-settings-controller">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening settings.
		</p>
	</div>
{/if}
