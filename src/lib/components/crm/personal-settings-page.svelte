<script lang="ts">
	import { browser } from '$app/environment';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MembershipRole, ProfilePreferencesData } from '$lib/schemas/organisation.js';
	import { roleLabel } from '$lib/schemas/organisation.js';
	import type {
		MailboxAccountResource,
		MailboxFormData,
		MailboxTestFeedback
	} from '$lib/schemas/mailbox.js';
	import {
		canMutateCalendarConnection,
		calendarProviderDisplayName,
		type CaldavFormData,
		type CaldavTestFeedback,
		type CalendarConnectionResource
	} from '$lib/schemas/calendar-connection.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ProfileTabs from './profile-tabs.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import ProfilePreferencesForm from './profile-preferences-form.svelte';
	import ProfileMailboxForm from './profile-mailbox-form.svelte';
	import ProfileCalendarForm from './profile-calendar-form.svelte';
	import ProfileCaldavForm from './profile-caldav-form.svelte';
	import { cn } from '$lib/utils.js';

	export interface PersonalSettingsPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role: MembershipRole;
		preferencesForm: SuperForm<ProfilePreferencesData>;
		mailboxForm: SuperForm<MailboxFormData>;
		mailboxAccount?: MailboxAccountResource | null;
		googleConnection?: CalendarConnectionResource | null;
		caldavConnection?: CalendarConnectionResource | null;
		/** Active push connection (XOR) — drives banner copy. */
		activeCalendarConnection?: CalendarConnectionResource | null;
		calendarConnectError?: string | null;
		caldavConnectError?: string | null;
		caldavForm: SuperForm<CaldavFormData>;
		viewState?: ResourceViewState;
		class?: string;
		showNav?: boolean;
		onReload?: () => void;
		onSavePreferences?: () => boolean | void | Promise<boolean | void>;
		onSaveMailbox?: () => boolean | void | Promise<boolean | void>;
		onTestMailbox?: () =>
			| MailboxTestFeedback
			| false
			| void
			| Promise<MailboxTestFeedback | false | void>;
		onSyncMailbox?: () =>
			| MailboxTestFeedback
			| false
			| void
			| Promise<MailboxTestFeedback | false | void>;
		onDisconnectMailbox?: () => boolean | void | Promise<boolean | void>;
		onConnectMailboxOAuth?: (
			provider: 'microsoft' | 'google'
		) => boolean | void | Promise<boolean | void>;
		mailboxOAuthError?: string | null;
		onConnectCalendar?: () => boolean | void | Promise<boolean | void>;
		onDisconnectCalendar?: () => boolean | void | Promise<boolean | void>;
		onSaveCaldav?: () => boolean | void | Promise<boolean | void>;
		onTestCaldav?: () =>
			| CaldavTestFeedback
			| false
			| void
			| Promise<CaldavTestFeedback | false | void>;
		onDisconnectCaldav?: () => boolean | void | Promise<boolean | void>;
	}

	function initialTab(): 'theme' | 'mail' | 'calendar' {
		if (!browser) return 'theme';
		if (window.location.hash === '#mail') return 'mail';
		if (window.location.hash === '#calendar') return 'calendar';
		return 'theme';
	}

	let {
		orgName,
		navGroups,
		role,
		preferencesForm,
		mailboxForm,
		mailboxAccount = null,
		googleConnection = null,
		caldavConnection = null,
		activeCalendarConnection = null,
		calendarConnectError = null,
		caldavConnectError = null,
		caldavForm,
		viewState = { kind: 'ready' },
		class: className,
		showNav = true,
		onReload,
		onSavePreferences,
		onSaveMailbox,
		onTestMailbox,
		onSyncMailbox,
		onDisconnectMailbox,
		onConnectMailboxOAuth,
		mailboxOAuthError = null,
		onConnectCalendar,
		onDisconnectCalendar,
		onSaveCaldav,
		onTestCaldav,
		onDisconnectCaldav
	}: PersonalSettingsPageProps = $props();

	const showContent = $derived(
		viewState.kind === 'ready' || viewState.kind === 'empty' || viewState.kind === 'conflict'
	);

	const tabs = [
		{ id: 'theme', label: 'Theme' },
		{ id: 'mail', label: 'Mail' },
		{ id: 'calendar', label: 'Calendar' }
	] as const;

	let activeTab = $state<(typeof tabs)[number]['id']>(initialTab());
	const canEditCalendar = $derived(canMutateCalendarConnection(role));
	const googleActive = $derived(
		googleConnection?.provider === 'google' &&
			googleConnection?.status === 'connected' &&
			Boolean(googleConnection?.credentials_configured)
	);
	const caldavActive = $derived(
		caldavConnection?.provider === 'caldav' &&
			caldavConnection?.status === 'connected' &&
			Boolean(caldavConnection?.credentials_configured)
	);
	const activeProviderLabel = $derived(
		activeCalendarConnection?.status === 'connected' && activeCalendarConnection.provider
			? calendarProviderDisplayName(activeCalendarConnection.provider)
			: null
	);
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="h-full shrink-0 self-stretch" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-8 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Organisation · Settings"
				title="My settings"
				description="Your personal theme, mailbox, and calendar for this organisation. Organisation defaults and AI providers stay under Owner Config / Integrations."
			>
				{#snippet actions()}
					<span class="text-muted-foreground text-xs">Your role: {roleLabel(role)}</span>
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if showContent}
				<ProfileTabs {tabs} bind:value={activeTab}>
					{#snippet children({ active })}
						{#if active === 'theme'}
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
						{:else if active === 'mail'}
							<section
								class="space-y-4 scroll-mt-6"
								id="mail"
								data-testid="personal-mail-section"
							>
								<div>
									<h2 class="text-lg font-semibold tracking-tight">Mail</h2>
									<p class="text-muted-foreground text-sm">
										Your personal IMAP/SMTP for this organisation membership — not organisation
										Email sending used for quotes and campaigns.
									</p>
								</div>
								<ProfileMailboxForm
									form={mailboxForm}
									account={mailboxAccount}
									oauthError={mailboxOAuthError}
									onValidSubmit={onSaveMailbox}
									onConnectOAuth={onConnectMailboxOAuth}
									onTest={onTestMailbox}
									onSync={onSyncMailbox}
									onDisconnect={onDisconnectMailbox}
								/>
							</section>
						{:else if active === 'calendar'}
							<section
								class="space-y-4 scroll-mt-6"
								id="calendar"
								data-testid="personal-calendar-section"
							>
								<div>
									<h2 class="text-lg font-semibold tracking-tight">Calendar</h2>
									<p class="text-muted-foreground text-sm">
										Connect Google OAuth or CalDAV (Mailcow/SOGo) for this organisation membership.
										Push is one-way from Headquarters meetings — the meetings calendar works without
										a connection.
									</p>
								</div>

								<p
									class="bg-muted/40 text-muted-foreground rounded-2xl px-3 py-3 text-xs leading-relaxed"
									data-testid="calendar-xor-banner"
								>
									{#if activeProviderLabel}
										Active sync: <span class="text-foreground font-medium">{activeProviderLabel}</span>.
										Only one provider can push at a time — connecting the other disables this one.
									{:else}
										Only one active sync per membership (XOR). Connecting Google or CalDAV disables
										the other if it was active.
									{/if}
								</p>

								<ProfileCalendarForm
									connection={googleConnection}
									otherProviderActive={caldavActive}
									connectError={calendarConnectError}
									canEdit={canEditCalendar}
									onConnect={onConnectCalendar}
									onDisconnect={onDisconnectCalendar}
								/>
								<ProfileCaldavForm
									form={caldavForm}
									connection={caldavConnection}
									otherProviderActive={googleActive}
									connectError={caldavConnectError}
									canEdit={canEditCalendar}
									onValidSubmit={onSaveCaldav}
									onTest={onTestCaldav}
									onDisconnect={onDisconnectCaldav}
								/>
							</section>
						{/if}
					{/snippet}
				</ProfileTabs>
			{/if}
		</div>
	</main>
</div>
