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
	import type { CalendarConnectionResource } from '$lib/schemas/calendar-connection.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ProfileTabs from './profile-tabs.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import ProfilePreferencesForm from './profile-preferences-form.svelte';
	import ProfileMailboxForm from './profile-mailbox-form.svelte';
	import ProfileCalendarForm from './profile-calendar-form.svelte';
	import { cn } from '$lib/utils.js';

	export interface PersonalSettingsPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role: MembershipRole;
		preferencesForm: SuperForm<ProfilePreferencesData>;
		mailboxForm: SuperForm<MailboxFormData>;
		mailboxAccount?: MailboxAccountResource | null;
		calendarConnection?: CalendarConnectionResource | null;
		calendarConnectError?: string | null;
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
		onConnectCalendar?: () => boolean | void | Promise<boolean | void>;
		onDisconnectCalendar?: () => boolean | void | Promise<boolean | void>;
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
		calendarConnection = null,
		calendarConnectError = null,
		viewState = { kind: 'ready' },
		class: className,
		showNav = true,
		onReload,
		onSavePreferences,
		onSaveMailbox,
		onTestMailbox,
		onSyncMailbox,
		onDisconnectMailbox,
		onConnectCalendar,
		onDisconnectCalendar
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
				description="Your personal theme, mailbox, and Google Calendar for this organisation. Organisation defaults and AI providers stay under Owner Config / Integrations."
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
									onValidSubmit={onSaveMailbox}
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
										Connect your personal Google Calendar for this organisation membership. Push
										is one-way from Headquarters meetings.
									</p>
								</div>
								<ProfileCalendarForm
									connection={calendarConnection}
									connectError={calendarConnectError}
									onConnect={onConnectCalendar}
									onDisconnect={onDisconnectCalendar}
								/>
							</section>
						{/if}
					{/snippet}
				</ProfileTabs>
			{/if}
		</div>
	</main>
</div>
