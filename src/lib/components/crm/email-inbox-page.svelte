<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		aiSuggestionText,
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import {
		preserveSelectedMessageId,
		startVisibilityPoll
	} from '$lib/browser/visibility-poll.js';
	import {
		emptyPersonalEmailInboxState,
		loadPersonalEmailInbox,
		type PersonalEmailInboxState
	} from '$lib/crm/personal-email-inbox.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { describeMailboxSyncResult } from '$lib/schemas/mailbox.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import EntityEmailInbox from './entity-email-inbox.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	/** Quiet list refresh while the Email tab is visible (list only — never IMAP Sync). */
	const INBOX_LIST_POLL_MS = 45_000;

	export interface EmailInboxPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Deep-link from notifications: `/email?message=<uuid>`. */
		initialMessageId?: string | null;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		initialMessageId = null,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: EmailInboxPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let inbox = $state<PersonalEmailInboxState>(emptyPersonalEmailInboxState());
	let selectedId = $state<string | undefined>(undefined);
	let pendingMessageId = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let syncPending = $state(false);
	let syncFeedback = $state<string | null>(null);

	$effect(() => {
		pendingMessageId = initialMessageId ?? null;
	});

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Email', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
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
		inbox = emptyPersonalEmailInboxState();
		selectedId = undefined;
		viewState = { kind: 'loading' };
	}

	async function loadAll(opts?: { quiet?: boolean }) {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening email.'
			};
			return;
		}

		const epoch = captureEpoch();
		const quiet = Boolean(opts?.quiet && viewState.kind === 'ready');
		if (!quiet) {
			viewState = { kind: 'loading' };
		}
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const next = await loadPersonalEmailInbox(api);
			if (isStale(epoch)) return;
			inbox = next;
			const ids = next.messages.map((m) => m.id);
			const deepLinkId = pendingMessageId;
			if (deepLinkId && ids.includes(deepLinkId)) {
				selectedId = deepLinkId;
				pendingMessageId = null;
			} else {
				selectedId = preserveSelectedMessageId(selectedId, ids);
			}
			if (next.listError) {
				viewState = {
					kind: 'validation',
					message: next.listError
				};
				return;
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
				message: userMessage(error, 'Could not load email inbox.')
			};
		}
	}

	function quietListRefresh() {
		// List reload only — never mailbox.sync / IMAP Sync on a timer.
		void loadAll({ quiet: true });
	}

	async function onSyncMailbox() {
		if (syncPending || !inbox.mailboxConnected) return;
		const epoch = captureEpoch();
		syncPending = true;
		syncFeedback = null;
		try {
			const result = await api.mailbox.sync();
			if (isStale(epoch)) return;
			syncFeedback = describeMailboxSyncResult(result);
			await loadAll();
		} catch (error) {
			if (isStale(epoch)) return;
			syncFeedback = userMessage(error, 'Could not sync mailbox.');
			viewState = {
				kind: 'validation',
				message: syncFeedback
			};
		} finally {
			syncPending = false;
		}
	}

	async function onSendReply(payload: { messageId: string; body: string }) {
		await api.emailMessages.reply(payload.messageId, { body_text: payload.body });
		await loadAll({ quiet: true });
	}

	async function onDraftResponse(payload: {
		messageId: string;
		tone: 'warm' | 'neutral' | 'firm';
	}) {
		const suggestion = await api.emailMessages.generateDraft({
			email_message_id: payload.messageId,
			variant: payload.tone
		});
		return {
			suggestionId: suggestion.id,
			suggestionText: aiSuggestionText(suggestion)
		};
	}

	async function onUseSuggestion(payload: { suggestionId?: string; text: string }) {
		if (!payload.suggestionId) return;
		await api.emailMessages.useDraft(payload.suggestionId, payload.text);
	}

	async function onDiscardSuggestion(payload: { suggestionId?: string }) {
		if (!payload.suggestionId) return;
		await api.emailMessages.discardDraft(payload.suggestionId);
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
			const result = await api.organisations.create(toOrganisationCreateBody(data));
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
		void session.selectedOrgId;
		void session.cacheGeneration;
		void loadAll();
	});

	$effect(() => {
		if (!session.selectedOrgId) return;
		return startVisibilityPoll({
			intervalMs: INBOX_LIST_POLL_MS,
			onTick: quietListRefresh,
			onVisible: quietListRefresh
		});
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="email-inbox-page">
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
			<div class="flex min-h-0 flex-1 flex-col">
				{#if viewState.kind !== 'ready' && viewState.kind !== 'validation'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{:else}
					<div class="flex min-h-0 flex-1 flex-col px-6 py-6 md:px-8">
						{#if viewState.kind === 'validation'}
							<div class="mb-4">
								<ResourceStateBanner state={viewState} onReload={loadAll} />
							</div>
						{/if}
						<PageHeader
							breadcrumb="Comms"
							title="Email"
							description="Your personal working inbox for this organisation. Contact Email tabs show address matches separately."
						>
							{#snippet actions()}
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={syncPending || !inbox.mailboxConnected}
									title={
										inbox.mailboxConnected
											? 'Fetch new mail for your connected mailbox'
											: 'Connect a mailbox under My settings → Mail first'
									}
									data-testid="email-inbox-sync"
									onclick={() => void onSyncMailbox()}
								>
									{syncPending ? 'Syncing…' : 'Sync now'}
								</Button>
							{/snippet}
						</PageHeader>
						{#if syncFeedback}
							<p
								class="text-muted-foreground mb-2 text-xs"
								role="status"
								data-testid="email-inbox-sync-feedback"
							>
								{syncFeedback}
							</p>
						{/if}
						<EntityEmailInbox
							messages={inbox.messages}
							emptyState={inbox.emptyState}
							mailboxConnected={inbox.mailboxConnected}
							aiProviderConnected={inbox.aiProviderConnected}
							smtpReady={inbox.smtpReady}
							bind:selectedId
							{role}
							canAddToTimeline={false}
							{onSendReply}
							{onDraftResponse}
							{onUseSuggestion}
							{onDiscardSuggestion}
							class="mt-6 min-h-0 flex-1"
						/>
					</div>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="email-inbox-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening email.
		</p>
	</div>
{/if}
