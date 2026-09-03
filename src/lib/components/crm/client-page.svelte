<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage as sharedUserMessage } from '$lib/api/v1/errors.js';
	import {
		aiSuggestionText,
		roleFromMemberships,
		clientStatusLabel,
		membershipFromCreateResult,
		toClientFormData,
		toClientRelatedContacts,
		toClientUpdateBody,
		toEntityProject,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiClient } from '$lib/api/v1/types.js';
	import type { EntityProject } from './entity-projects.svelte';
	import { loadClientMoneyItems } from '$lib/crm/client-money-tab.js';
	import {
		emptyEntityEmailTabState,
		loadEntityEmailTab,
		type EntityEmailTabState
	} from '$lib/crm/entity-email-tab.js';
	import { createEntityTimelineEvent, loadEntityTimeline } from '$lib/crm/entity-timeline.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { clientFormSchema, type ClientFormData } from '$lib/schemas/client.js';
	import {
		canMutateCrmRecords,
		type MembershipRole,
		type OrganisationCreateData
	} from '$lib/schemas/organisation.js';
	import type { InfoCardField } from './info-card.svelte';
	import type { MoneySummaryItem } from './money-summary.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import type { TimelineComposerSubmit } from './timeline-composer.svelte';
	import type { TimelineEvent } from './timeline.svelte';
	import AppShell from './app-shell.svelte';
	import ClientProfilePage from './client-profile-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ClientPageProps {
		api: ApiV1Client;
		session: OrgSession;
		clientId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onDeleted?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		clientId,
		onMissingOrg,
		onSwitchNavigate,
		onDeleted,
		onLogout,
		class: className
	}: ClientPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let client = $state<ApiClient | null>(null);
	let projects = $state<EntityProject[]>([]);
	let moneyItems = $state<MoneySummaryItem[]>([]);
	let emailTab = $state<EntityEmailTabState>(emptyEntityEmailTabState());
	let timelineEvents = $state<TimelineEvent[]>([]);
	let sharingId = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let editDrawerOpen = $state(false);

	const emptyClientForm = (): ClientFormData => ({
		name: '',
		status: 'active',
		websiteUrl: '',
		industry: '',
		primaryEmail: '',
		invoicingEmail: '',
		emailDomain: '',
		phone: '',
		taxIdentifier: '',
		taxExempt: false,
		registrationNumber: '',
		defaultCurrency: 'GBP',
		paymentTermsDays: '',
		renewalOn: '',
		notes: ''
	});

	const clientForm = superForm(defaults(emptyClientForm(), zod4(clientFormSchema)), {
		validators: zod4(clientFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ?? 'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ?? 'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Clients', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	const companyFields = $derived<InfoCardField[]>(
		client
			? [
					{ label: 'Industry', value: client.industry ?? '—' },
					{ label: 'Website', value: client.website_url ?? '—' },
					{ label: 'Primary email', value: client.primary_email ?? '—' },
					{ label: 'Invoicing email', value: client.invoicing_email ?? '—' },
					{ label: 'Email domain', value: client.email_domain ?? '—' },
					{ label: 'Phone', value: client.phone ?? '—' },
					{ label: 'Notes', value: client.notes ?? '—' }
				]
			: []
	);

	const billingFields = $derived<InfoCardField[]>(
		client
			? [
					{ label: 'Default currency', value: client.default_currency ?? '—' },
					{
						label: 'Payment terms (days)',
						value: client.payment_terms_days == null ? '—' : String(client.payment_terms_days)
					},
					{ label: 'Tax identifier', value: client.tax_identifier ?? '—' },
					{ label: 'VAT exempt', value: client.tax_exempt ? 'Yes' : 'No' },
					{ label: 'Registration number', value: client.registration_number ?? '—' },
					{ label: 'Renewal on', value: client.renewal_on ?? '—' }
				]
			: []
	);

	const relatedContacts = $derived(toClientRelatedContacts(client?.contacts));

	function userMessage(error: unknown, fallback: string): string {
		return sharedUserMessage(error, fallback, { notFoundMessage: 'Client not found.' });
	}

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		clientId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		clientId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.clientId = clientId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			clientId: liveEpoch.clientId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.clientId !== liveEpoch.clientId
		);
	}

	function resetOrgScopedState() {
		client = null;
		projects = [];
		moneyItems = [];
		emailTab = emptyEntityEmailTabState();
		timelineEvents = [];
		sharingId = null;
		editDrawerOpen = false;
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening clients.'
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

			const result = await api.clients.get(clientId);
			if (isStale(epoch)) return;

			client = result.data;
			clientForm.form.set(toClientFormData(result.data));
			viewState = { kind: 'ready' };

			const [tab, timeline, projectList, money] = await Promise.all([
				loadEntityEmailTab(api, 'client', clientId),
				loadEntityTimeline(api, 'client', clientId),
				api.projects.list({ client_id: clientId, limit: 50 }).catch(() => ({
					data: [] as Awaited<ReturnType<typeof api.projects.list>>['data']
				})),
				loadClientMoneyItems(api, clientId)
			]);
			if (isStale(epoch)) return;
			emailTab = tab;
			timelineEvents = timeline;
			projects = projectList.data.map(toEntityProject);
			moneyItems = money;
		} catch (error) {
			if (isStale(epoch)) return;
			client = null;
			projects = [];
			moneyItems = [];
			emailTab = emptyEntityEmailTabState();
			timelineEvents = [];
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'not_found', message: 'Client not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load client.')
			};
		}
	}

	async function onAddToTimeline(payload: { messageId: string }) {
		sharingId = payload.messageId;
		try {
			await api.emailMessages.share(payload.messageId, {
				entity_type: 'client',
				entity_id: clientId
			});
			const [tab, timeline] = await Promise.all([
				loadEntityEmailTab(api, 'client', clientId),
				loadEntityTimeline(api, 'client', clientId)
			]);
			emailTab = tab;
			timelineEvents = timeline;
		} finally {
			sharingId = null;
		}
	}

	async function onSendReply(payload: { messageId: string; body: string }) {
		await api.emailMessages.reply(payload.messageId, { body_text: payload.body });
		emailTab = await loadEntityEmailTab(api, 'client', clientId);
	}

	async function onSendNew(payload: { to: string; subject: string; body: string }) {
		await api.emailMessages.sendForEntity('client', clientId, {
			to: payload.to,
			subject: payload.subject,
			body_text: payload.body
		});
		emailTab = await loadEntityEmailTab(api, 'client', clientId);
	}

	async function onTimelineAdd(submit: TimelineComposerSubmit) {
		const created = await createEntityTimelineEvent(api, 'client', clientId, submit);
		timelineEvents = [created, ...timelineEvents.filter((event) => event.id !== created.id)];
	}

	async function onDraftResponse(payload: {
		messageId: string;
		tone: 'warm' | 'neutral' | 'firm';
	}) {
		const suggestion = await api.emailMessages.generateDraft({
			email_message_id: payload.messageId,
			variant: payload.tone
		});
		return { suggestionId: suggestion.id, suggestionText: aiSuggestionText(suggestion) };
	}

	async function onDraftCompose(payload: {
		tone: 'warm' | 'neutral' | 'firm';
		subject: string;
		to: string;
	}) {
		void payload.to;
		const suggestion = await api.emailMessages.generateComposeDraft({
			entity_type: 'client',
			entity_id: clientId,
			variant: payload.tone,
			subject: payload.subject
		});
		return { suggestionId: suggestion.id, suggestionText: aiSuggestionText(suggestion) };
	}

	async function onUseSuggestion(payload: { suggestionId?: string; text: string }) {
		if (payload.suggestionId) await api.emailMessages.useDraft(payload.suggestionId, payload.text);
	}

	async function onDiscardSuggestion(payload: { suggestionId?: string }) {
		if (payload.suggestionId) await api.emailMessages.discardDraft(payload.suggestionId);
	}

	async function onSaveClient(): Promise<boolean> {
		if (!client) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.clients.update(
				client.id,
				toClientUpdateBody(get(clientForm.form)),
				client.version
			);
			if (isStale(epoch)) return false;
			client = updated;
			clientForm.form.set(toClientFormData(updated));
			editDrawerOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save client — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onDelete() {
		if (!client || !canMutateCrmRecords(role)) return;
		if (!window.confirm('Delete this client? This cannot be undone.')) return;
		const epoch = captureEpoch();
		try {
			await api.clients.delete(client.id, client.version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not delete client — try again.')
			};
		}
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
		void clientId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="client-page">
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
				{#if viewState.kind !== 'ready' && !client}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{:else if client}
					{#if viewState.kind === 'validation' || viewState.kind === 'conflict'}
						<div class="px-6 pt-6 md:px-8">
							<ResourceStateBanner state={viewState} onReload={loadAll} />
						</div>
					{/if}
					<ClientProfilePage
						{orgName}
						{navGroups}
						breadcrumb="Clients"
						title={client.name}
						status={clientStatusLabel(client.status)}
						subtitle={client.industry ?? undefined}
						{companyFields}
						{billingFields}
						{relatedContacts}
						{clientForm}
						bind:editDrawerOpen
						{viewState}
						bind:timelineEvents
						emailMessages={emailTab.messages}
						emailEmptyState={emailTab.emptyState}
						mailboxConnected={emailTab.mailboxConnected}
						aiProviderConnected={emailTab.aiProviderConnected}
						smtpReady={emailTab.smtpReady}
						emailDefaultTo={client.primary_email ?? ''}
						{role}
						{sharingId}
						documentsApi={api}
						documentsEntityId={client.id}
						documentsReloadKey={session.cacheGeneration}
						{projects}
						{moneyItems}
						clientId={client.id}
						{onTimelineAdd}
						{onAddToTimeline}
						{onSendReply}
						{onSendNew}
						{onDraftResponse}
						{onDraftCompose}
						{onUseSuggestion}
						{onDiscardSuggestion}
						onValidSubmit={onSaveClient}
						onDelete={canMutateCrmRecords(role) ? onDelete : undefined}
						onReload={loadAll}
						showNav={false}
						tagsApi={api}
						tagsEntityType="client"
						tagsEntityId={client.id}
						tagsCanEdit={canMutateCrmRecords(role)}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="client-page">
		<p class="text-sm text-destructive" role="alert">
			Select an organisation before opening clients.
		</p>
	</div>
{/if}
