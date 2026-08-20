<script lang="ts">
	import { browser } from '$app/environment';
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
		toCaldavPutBody,
		toCalendarConnectionResource,
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
		clearMailboxDraft,
		getMailboxDraft,
		mailboxFormFromServer,
		setMailboxDraft,
		shouldRetainMailboxDraft
	} from '$lib/personal-settings/mailbox-draft.js';
	import {
		describeMailboxSyncResult,
		emptyMailboxFormData,
		humanizeMailboxSyncError,
		mailboxFormSchema,
		type MailboxAccountResource,
		type MailboxTestFeedback
	} from '$lib/schemas/mailbox.js';
	import {
		caldavFormFromResource,
		caldavFormSchema,
		canMutateCalendarConnection,
		emptyCaldavFormData,
		emptyCalendarConnection,
		type CaldavTestFeedback,
		type CalendarConnectionResource
	} from '$lib/schemas/calendar-connection.js';
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
	let activeCalendarConnection = $state<CalendarConnectionResource>(emptyCalendarConnection());
	let googleConnection = $state<CalendarConnectionResource>(emptyCalendarConnection());
	let caldavConnection = $state<CalendarConnectionResource>(emptyCalendarConnection());
	let calendarConnectError = $state<string | null>(null);
	let caldavConnectError = $state<string | null>(null);
	let mailboxOAuthError = $state<string | null>(null);
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

	const caldavForm = superForm(defaults(emptyCaldavFormData(), zod4(caldavFormSchema)), {
		validators: zod4(caldavFormSchema),
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

	function applyMailboxFormFromServer(
		orgId: string,
		account: MailboxAccountResource | null,
		force = false
	) {
		if (!force && shouldRetainMailboxDraft(orgId, account, get(mailboxForm.form))) {
			const draft = getMailboxDraft(orgId);
			if (draft) mailboxForm.form.set(draft);
			return;
		}
		mailboxForm.form.set(mailboxFormFromServer(account));
		if (!force) clearMailboxDraft(orgId);
	}

	async function loadAll(options?: { forceMailboxReload?: boolean }) {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening settings.'
			};
			return;
		}

		const epoch = captureEpoch();
		const orgId = session.selectedOrgId;
		if (options?.forceMailboxReload && orgId) {
			clearMailboxDraft(orgId);
		}
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
				mailboxAccount = account ? toMailboxAccountResource(account) : null;
				if (orgId) {
					applyMailboxFormFromServer(
						orgId,
						mailboxAccount,
						options?.forceMailboxReload ?? false
					);
				}
			} catch (error) {
				if (isStale(epoch)) return;
				mailboxAccount = null;
				if (orgId) {
					applyMailboxFormFromServer(
						orgId,
						null,
						options?.forceMailboxReload ?? false
					);
				}
				if (
					!(
						isApiClientError(error) &&
						(error.status === 404 || error.code === 'NOT_FOUND')
					)
				) {
					// Non-fatal — still show prefs.
				}
			}

			try {
				const [active, google, caldav] = await Promise.all([
					api.calendar.get(),
					api.calendar.get(undefined, { provider: 'google' }),
					api.calendar.get(undefined, { provider: 'caldav' })
				]);
				if (isStale(epoch)) return;
				activeCalendarConnection = toCalendarConnectionResource(active);
				googleConnection = toCalendarConnectionResource(google);
				caldavConnection = toCalendarConnectionResource(caldav);
				caldavForm.form.set(caldavFormFromResource(caldavConnection));
				calendarConnectError = null;
				caldavConnectError = null;
			} catch (error) {
				if (isStale(epoch)) return;
				activeCalendarConnection = emptyCalendarConnection();
				googleConnection = emptyCalendarConnection();
				caldavConnection = emptyCalendarConnection();
				caldavForm.form.set(emptyCaldavFormData());
				if (
					!(
						isApiClientError(error) &&
						(error.status === 404 || error.code === 'NOT_FOUND')
					)
				) {
					calendarConnectError = userMessage(error, 'Could not load calendar connection.');
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
			if (session.selectedOrgId) clearMailboxDraft(session.selectedOrgId);
			mailboxForm.form.set(mailboxFormFromServer(mailboxAccount));
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

	async function onTestMailbox(): Promise<MailboxTestFeedback | false> {
		const epoch = captureEpoch();
		try {
			const result = await api.mailbox.test();
			if (isStale(epoch)) return false;
			if (!result.ok) {
				const humanized = humanizeMailboxSyncError(result.error_code);
				// Prefer known code copy (e.g. timeout); keep API message for unknown codes.
				const known =
					humanized != null && !humanized.startsWith('Sync issue (');
				return {
					ok: false,
					message:
						(known ? humanized : null) ||
						result.message ||
						humanized ||
						result.error_code ||
						'Mailbox test failed.'
				};
			}
			void loadAll();
			viewState = { kind: 'ready' };
			return {
				ok: true,
				message: result.message?.trim() || 'Connection successful.'
			};
		} catch (error) {
			if (isStale(epoch)) return false;
			return {
				ok: false,
				message: userMessage(error, 'Mailbox test failed.')
			};
		}
	}

	async function onSyncMailbox(): Promise<MailboxTestFeedback | false> {
		const epoch = captureEpoch();
		try {
			const result = await api.mailbox.sync();
			if (isStale(epoch)) return false;
			void loadAll({ forceMailboxReload: true });
			viewState = { kind: 'ready' };
			return {
				ok: result.ok,
				message: describeMailboxSyncResult(result)
			};
		} catch (error) {
			if (isStale(epoch)) return false;
			return {
				ok: false,
				message: userMessage(error, 'Mailbox sync failed.')
			};
		}
	}

	async function onSaveMailboxSyncInterval(
		minutes: number
	): Promise<MailboxTestFeedback | false> {
		const epoch = captureEpoch();
		try {
			const updated = await api.mailbox.updateSyncInterval(minutes);
			if (isStale(epoch)) return false;
			mailboxAccount = toMailboxAccountResource(updated);
			return { ok: true, message: 'Sync interval saved.' };
		} catch (error) {
			if (isStale(epoch)) return false;
			return {
				ok: false,
				message: userMessage(error, 'Could not save sync interval.')
			};
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
			if (session.selectedOrgId) clearMailboxDraft(session.selectedOrgId);
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

	async function onConnectMailboxOAuth(provider: 'microsoft' | 'google') {
		const epoch = captureEpoch();
		mailboxOAuthError = null;
		try {
			const start = await api.mailbox.startOAuth(provider);
			if (isStale(epoch)) return false;
			const redirectUrl = start?.url?.trim() ?? '';
			if (!redirectUrl) {
				mailboxOAuthError = 'Mailbox OAuth start did not return a redirect URL.';
				return false;
			}
			if (browser) {
				window.location.assign(redirectUrl);
			}
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			mailboxOAuthError = userMessage(error, 'Could not start mailbox connect.');
			return false;
		}
	}

	async function onConnectCalendar() {
		const epoch = captureEpoch();
		calendarConnectError = null;
		if (!canMutateCalendarConnection(role)) {
			calendarConnectError = 'Readonly members cannot connect Google Calendar.';
			return false;
		}
		try {
			const start = await api.calendar.startOAuth();
			if (isStale(epoch)) return false;
			const redirectUrl = start?.url?.trim() ?? '';
			if (!redirectUrl) {
				calendarConnectError = 'Calendar OAuth start did not return a redirect URL.';
				return false;
			}
			if (browser) {
				window.location.assign(redirectUrl);
			}
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			calendarConnectError = userMessage(error, 'Could not start Google Calendar connect.');
			return false;
		}
	}

	async function onDisconnectCalendar() {
		const epoch = captureEpoch();
		calendarConnectError = null;
		try {
			await api.calendar.disconnect({ provider: 'google' });
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			void loadAll();
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			calendarConnectError = userMessage(error, 'Could not disconnect Google Calendar.');
			return false;
		}
	}

	async function onSaveCaldav() {
		const epoch = captureEpoch();
		caldavConnectError = null;
		if (!canMutateCalendarConnection(role)) {
			caldavConnectError = 'Readonly members cannot connect CalDAV.';
			return false;
		}
		const values = get(caldavForm.form);
		if (!caldavConnection.credentials_configured && !values.password.trim()) {
			caldavConnectError = 'Password is required for the first CalDAV save.';
			return false;
		}
		try {
			const updated = await api.calendar.put(toCaldavPutBody(values));
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			caldavConnection = toCalendarConnectionResource(updated);
			caldavForm.form.set(caldavFormFromResource(caldavConnection));
			void loadAll();
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			caldavConnectError = userMessage(error, 'Could not save CalDAV connection.');
			return false;
		}
	}

	async function onTestCaldav(): Promise<CaldavTestFeedback | false> {
		const epoch = captureEpoch();
		caldavConnectError = null;
		try {
			const password = get(caldavForm.form).password.trim();
			const result = await api.calendar.test(password ? { password } : undefined);
			if (isStale(epoch)) return false;
			if (!result.ok) {
				return {
					ok: false,
					message: result.message?.trim() || result.error_code || 'CalDAV test failed.'
				};
			}
			return {
				ok: true,
				message: result.message?.trim() || 'Connection successful.'
			};
		} catch (error) {
			if (isStale(epoch)) return false;
			return {
				ok: false,
				message: userMessage(error, 'CalDAV test failed.')
			};
		}
	}

	async function onDisconnectCaldav() {
		const epoch = captureEpoch();
		caldavConnectError = null;
		try {
			await api.calendar.disconnect({ provider: 'caldav' });
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			caldavConnection = emptyCalendarConnection();
			caldavForm.form.set(emptyCaldavFormData());
			void loadAll();
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			caldavConnectError = userMessage(error, 'Could not disconnect CalDAV.');
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

	$effect(() => {
		const orgId = session.selectedOrgId;
		if (!orgId) return;
		const unsubscribe = mailboxForm.form.subscribe((values) => {
			setMailboxDraft(orgId, values);
		});
		return unsubscribe;
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
				{googleConnection}
				{caldavConnection}
				{activeCalendarConnection}
				{calendarConnectError}
				{caldavConnectError}
				{caldavForm}
				{viewState}
				onReload={() => loadAll({ forceMailboxReload: true })}
				{onSavePreferences}
				{onSaveMailbox}
				{onTestMailbox}
				{onSyncMailbox}
				{onSaveMailboxSyncInterval}
				{onDisconnectMailbox}
				{onConnectMailboxOAuth}
				{mailboxOAuthError}
				{onConnectCalendar}
				{onDisconnectCalendar}
				{onSaveCaldav}
				{onTestCaldav}
				{onDisconnectCaldav}
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
