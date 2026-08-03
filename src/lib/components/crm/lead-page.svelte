<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		aiSuggestionText,
		roleFromMemberships,
		membershipFromCreateResult,
		toClientCreateBody,
		toClientResource,
		toLeadConvertBody,
		toLeadFormData,
		toLeadResource,
		toLeadUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiLead } from '$lib/api/v1/types.js';
	import {
		emptyEntityEmailTabState,
		loadEntityEmailTab,
		type EntityEmailTabState
	} from '$lib/crm/entity-email-tab.js';
	import {
		createEntityTimelineEvent,
		loadEntityTimeline
	} from '$lib/crm/entity-timeline.js';
	import { resolveLeadCurrency } from '$lib/money.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { clientFormSchema, type ClientFormData } from '$lib/schemas/client.js';
	import {
		convertLeadFormSchema,
		leadFormSchema,
		type LeadClientOption,
		type LeadFormData,
		type LeadResource
	} from '$lib/schemas/lead.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { LeadConvertResult } from './lead-detail-page.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import type { TimelineComposerSubmit } from './timeline-composer.svelte';
	import type { TimelineEvent } from './timeline.svelte';
	import AppShell from './app-shell.svelte';
	import ClientFormDrawer from './client-form-drawer.svelte';
	import LeadDetailPage from './lead-detail-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface LeadPageProps {
		api: ApiV1Client;
		session: OrgSession;
		leadId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onOpenClient?: (clientId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		leadId,
		onMissingOrg,
		onSwitchNavigate,
		onOpenClient,
		onLogout,
		class: className
	}: LeadPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let lead = $state<ApiLead | null>(null);
	let emailTab = $state<EntityEmailTabState>(emptyEntityEmailTabState());
	let timelineEvents = $state<TimelineEvent[]>([]);
	let sharingId = $state<string | null>(null);
	let clientOptions = $state<LeadClientOption[]>([]);
	let orgCurrency = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let convertOpen = $state(false);
	let converting = $state(false);
	let clientDrawerOpen = $state(false);
	let lastConvertResult = $state<LeadConvertResult | null>(null);

	const emptyLeadForm = (currency = 'GBP'): LeadFormData => ({
		name: '',
		companyName: '',
		clientId: '',
		stage: 'new',
		valueAmount: '',
		currency,
		probabilityPercent: '',
		source: '',
		expectedCloseOn: '',
		lostReason: '',
		notes: ''
	});

	const emptyClientForm = (): ClientFormData => ({
		name: '',
		status: 'active',
		websiteUrl: '',
		industry: '',
		primaryEmail: '',
		phone: '',
		taxIdentifier: '',
		registrationNumber: '',
		defaultCurrency: '',
		paymentTermsDays: '',
		renewalOn: '',
		notes: ''
	});

	const leadForm = superForm(defaults(emptyLeadForm(), zod4(leadFormSchema)), {
		validators: zod4(leadFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const convertForm = superForm(
		defaults({ clientName: '', clientStatus: 'active' as const }, zod4(convertLeadFormSchema)),
		{
			validators: zod4(convertLeadFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const clientForm = superForm(defaults(emptyClientForm(), zod4(clientFormSchema)), {
		validators: zod4(clientFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Leads', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const leadResource = $derived<LeadResource | null>(lead ? toLeadResource(lead) : null);

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Lead not found.';
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
		leadId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		leadId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.leadId = leadId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			leadId: liveEpoch.leadId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.leadId !== liveEpoch.leadId
		);
	}

	function resetOrgScopedState() {
		lead = null;
		emailTab = emptyEntityEmailTabState();
		timelineEvents = [];
		sharingId = null;
		clientOptions = [];
		orgCurrency = null;
		lastConvertResult = null;
		convertOpen = false;
		clientDrawerOpen = false;
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening leads.'
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

			const [result, clientsListed, config] = await Promise.all([
				api.leads.get(leadId),
				api.clients.list({ limit: 100 }),
				api.organisationConfig.get()
			]);
			if (isStale(epoch)) return;

			orgCurrency = config.default_currency ?? null;
			clientOptions = clientsListed.data
				.filter((c) => c.status !== 'archived')
				.map((c) => ({
					id: c.id,
					name: c.name,
					defaultCurrency: c.default_currency
				}));
			lead = result.data;
			leadForm.form.set(toLeadFormData(result.data));
			viewState = { kind: 'ready' };

			const [tab, timeline] = await Promise.all([
				loadEntityEmailTab(api, 'lead', leadId),
				loadEntityTimeline(api, 'lead', leadId)
			]);
			if (isStale(epoch)) return;
			emailTab = tab;
			timelineEvents = timeline;
		} catch (error) {
			if (isStale(epoch)) return;
			lead = null;
			emailTab = emptyEntityEmailTabState();
			timelineEvents = [];
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'not_found', message: 'Lead not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load lead.')
			};
		}
	}

	async function onAddToTimeline(payload: { messageId: string }) {
		sharingId = payload.messageId;
		try {
			await api.emailMessages.share(payload.messageId, {
				entity_type: 'lead',
				entity_id: leadId
			});
			const [tab, timeline] = await Promise.all([
				loadEntityEmailTab(api, 'lead', leadId),
				loadEntityTimeline(api, 'lead', leadId)
			]);
			emailTab = tab;
			timelineEvents = timeline;
		} finally {
			sharingId = null;
		}
	}

	async function onTimelineAdd(submit: TimelineComposerSubmit) {
		const created = await createEntityTimelineEvent(api, 'lead', leadId, submit);
		timelineEvents = [created, ...timelineEvents.filter((event) => event.id !== created.id)];
	}

	async function onDraftResponse(payload: { messageId: string; tone: 'warm' | 'neutral' | 'firm' }) {
		const suggestion = await api.emailMessages.generateDraft({
			email_message_id: payload.messageId,
			variant: payload.tone
		});
		return { suggestionId: suggestion.id, suggestionText: aiSuggestionText(suggestion) };
	}

	async function onUseSuggestion(payload: { suggestionId?: string; text: string }) {
		if (payload.suggestionId) await api.emailMessages.useDraft(payload.suggestionId, payload.text);
	}

	async function onDiscardSuggestion(payload: { suggestionId?: string }) {
		if (payload.suggestionId) await api.emailMessages.discardDraft(payload.suggestionId);
	}

	async function onSave(): Promise<boolean> {
		if (!lead) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.leads.update(
				lead.id,
				toLeadUpdateBody(get(leadForm.form)),
				lead.version
			);
			if (isStale(epoch)) return false;
			lead = updated;
			leadForm.form.set(toLeadFormData(updated));
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save lead — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onConvert() {
		if (!lead) return;
		const epoch = captureEpoch();
		converting = true;
		try {
			const result = await api.leads.convert(lead.id, toLeadConvertBody(get(convertForm.form)));
			if (isStale(epoch)) return;
			lead = result.lead;
			leadForm.form.set(toLeadFormData(result.lead));
			lastConvertResult = {
				lead: toLeadResource(result.lead),
				client: toClientResource(result.client),
				idempotent: result.idempotent
			};
			convertOpen = false;
			timelineEvents = await loadEntityTimeline(api, 'lead', leadId);
			if (isStale(epoch)) return;
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not convert lead — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
		} finally {
			converting = false;
		}
	}

	async function onCreateClientFromLead(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.clients.create(toClientCreateBody(get(clientForm.form)));
			if (isStale(epoch)) return false;
			const option: LeadClientOption = {
				id: created.id,
				name: created.name,
				defaultCurrency: created.default_currency
			};
			clientOptions = [option, ...clientOptions.filter((c) => c.id !== option.id)];
			leadForm.form.update((current) => ({
				...current,
				clientId: option.id,
				currency: resolveLeadCurrency({
					clientCurrency: option.defaultCurrency,
					orgCurrency
				})
			}));
			clientForm.form.set(emptyClientForm());
			clientDrawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create client — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
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
		void leadId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="lead-page">
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
				{#if viewState.kind !== 'ready'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{:else if leadResource}
					<LeadDetailPage
						{orgName}
						{navGroups}
						lead={leadResource}
						{leadForm}
						{convertForm}
						{clientOptions}
						{orgCurrency}
						{viewState}
						bind:convertOpen
						{converting}
						{lastConvertResult}
						bind:timelineEvents
						emailMessages={emailTab.messages}
						emailEmptyState={emailTab.emptyState}
						mailboxConnected={emailTab.mailboxConnected}
						aiProviderConnected={emailTab.aiProviderConnected}
						smtpReady={emailTab.smtpReady}
						{role}
						{sharingId}
						{onTimelineAdd}
						{onAddToTimeline}
						{onDraftResponse}
						{onUseSuggestion}
						{onDiscardSuggestion}
						{onSave}
						{onConvert}
						{onOpenClient}
						onCreateClient={() => {
							clientForm.form.set({
								...emptyClientForm(),
								defaultCurrency: orgCurrency ?? ''
							});
							clientDrawerOpen = true;
						}}
						onReload={loadAll}
						showNav={false}
						class="min-h-0 flex-1"
					/>
					<ClientFormDrawer
						bind:open={clientDrawerOpen}
						form={clientForm}
						showTrigger={false}
						title="New client"
						description="Create a client and link it to this lead."
						onValidSubmit={onCreateClientFromLead}
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="lead-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening leads.
		</p>
	</div>
{/if}
