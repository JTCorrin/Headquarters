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
		emptyPersonalEmailInboxState,
		loadPersonalEmailInbox,
		type PersonalEmailInboxState
	} from '$lib/crm/personal-email-inbox.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import EntityEmailInbox from './entity-email-inbox.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface EmailInboxPageProps {
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
	}: EmailInboxPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let inbox = $state<PersonalEmailInboxState>(emptyPersonalEmailInboxState());
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

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
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening email.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const next = await loadPersonalEmailInbox(api);
			if (isStale(epoch)) return;
			inbox = next;
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
							description="Your personal working inbox for this organisation."
						/>
						<EntityEmailInbox
							messages={inbox.messages}
							emptyState={inbox.emptyState}
							mailboxConnected={inbox.mailboxConnected}
							aiProviderConnected={inbox.aiProviderConnected}
							smtpReady={inbox.smtpReady}
							{role}
							canAddToTimeline={false}
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
