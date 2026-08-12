<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		aiSuggestionText,
		roleFromMemberships,
		contactLifecycleLabel,
		membershipFromCreateResult,
		toContactFormData,
		toContactUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiContact } from '$lib/api/v1/types.js';
	import {
		emptyEntityEmailTabState,
		loadEntityEmailTab,
		type EntityEmailTabState
	} from '$lib/crm/entity-email-tab.js';
	import {
		createEntityTimelineEvent,
		loadEntityTimeline
	} from '$lib/crm/entity-timeline.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { contactFormSchema, type ContactFormData } from '$lib/schemas/contact.js';
	import type { LeadClientOption } from '$lib/schemas/lead.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { InfoCardField } from './info-card.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import type { TimelineComposerSubmit } from './timeline-composer.svelte';
	import type { TimelineEvent } from './timeline.svelte';
	import AppShell from './app-shell.svelte';
	import ContactProfilePage from './contact-profile-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ContactPageProps {
		api: ApiV1Client;
		session: OrgSession;
		contactId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		contactId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: ContactPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let contact = $state<ApiContact | null>(null);
	let emailTab = $state<EntityEmailTabState>(emptyEntityEmailTabState());
	let timelineEvents = $state<TimelineEvent[]>([]);
	let sharingId = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let editDrawerOpen = $state(false);
	let clientOptions = $state<LeadClientOption[]>([]);

	const emptyContactForm = (): ContactFormData => ({
		name: '',
		email: '',
		phone: '',
		company: '',
		title: '',
		status: 'active',
		clientId: ''
	});

	const contactForm = superForm(defaults(emptyContactForm(), zod4(contactFormSchema)), {
		validators: zod4(contactFormSchema),
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
	const navGroups = $derived(appNavGroups('Contacts', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	const contactFields = $derived.by((): InfoCardField[] => {
		if (!contact) return [];
		return [
			{ label: 'Email', value: contact.primary_email ?? '—' },
			{ label: 'Phone', value: contact.primary_phone ?? '—' },
			{ label: 'Title', value: contact.job_title ?? '—' },
			{ label: 'Source', value: contact.source ?? '—' }
		];
	});

	const companyFields = $derived.by((): InfoCardField[] => {
		if (!contact) return [];
		return [
			{ label: 'Company', value: contact.company_name ?? '—' },
			{ label: 'Lifecycle', value: contactLifecycleLabel(contact.lifecycle_status) },
			{ label: 'Notes', value: contact.notes ?? '—' }
		];
	});

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Contact not found.';
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
		contactId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		contactId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.contactId = contactId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			contactId: liveEpoch.contactId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.contactId !== liveEpoch.contactId
		);
	}

	function resetOrgScopedState() {
		contact = null;
		emailTab = emptyEntityEmailTabState();
		timelineEvents = [];
		sharingId = null;
		clientOptions = [];
		editDrawerOpen = false;
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening contacts.'
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

			const [result, clientsListed] = await Promise.all([
				api.contacts.get(contactId),
				api.clients.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			contact = result.data;
			contactForm.form.set(toContactFormData(result.data, result.data.client_id));
			clientOptions = clientsListed.data
				.filter((c) => c.status !== 'archived')
				.map((c) => ({
					id: c.id,
					name: c.name,
					defaultCurrency: c.default_currency
				}));
			viewState = { kind: 'ready' };

			const [tab, timeline] = await Promise.all([
				loadEntityEmailTab(api, 'contact', contactId),
				loadEntityTimeline(api, 'contact', contactId)
			]);
			if (isStale(epoch)) return;
			emailTab = tab;
			timelineEvents = timeline;
		} catch (error) {
			if (isStale(epoch)) return;
			contact = null;
			emailTab = emptyEntityEmailTabState();
			timelineEvents = [];
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'not_found', message: 'Contact not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load contact.')
			};
		}
	}

	async function onSaveContact(): Promise<boolean> {
		if (!contact) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.contacts.update(
				contact.id,
				toContactUpdateBody(get(contactForm.form)),
				contact.version
			);
			if (isStale(epoch)) return false;
			contact = updated;
			contactForm.form.set(toContactFormData(updated, updated.client_id));
			editDrawerOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save contact — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onAddToTimeline(payload: { messageId: string }) {
		sharingId = payload.messageId;
		try {
			await api.emailMessages.share(payload.messageId, {
				entity_type: 'contact',
				entity_id: contactId
			});
			const [tab, timeline] = await Promise.all([
				loadEntityEmailTab(api, 'contact', contactId),
				loadEntityTimeline(api, 'contact', contactId)
			]);
			emailTab = tab;
			timelineEvents = timeline;
		} finally {
			sharingId = null;
		}
	}

	async function onSendReply(payload: { messageId: string; body: string }) {
		await api.emailMessages.reply(payload.messageId, { body_text: payload.body });
		emailTab = await loadEntityEmailTab(api, 'contact', contactId);
	}

	async function onTimelineAdd(submit: TimelineComposerSubmit) {
		const created = await createEntityTimelineEvent(api, 'contact', contactId, submit);
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
		void contactId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="contact-page">
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
				{#if !contact}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{:else}
					{#if viewState.kind === 'validation'}
						<div class="px-6 pt-6 md:px-8">
							<ResourceStateBanner state={viewState} onReload={loadAll} />
						</div>
					{/if}
					<ContactProfilePage
						{orgName}
						{navGroups}
						breadcrumb="Contacts / {contact.display_name}"
						title={contact.display_name}
						status={contactLifecycleLabel(contact.lifecycle_status)}
						subtitle={contact.company_name
							? `${contact.company_name}${contact.job_title ? ` · ${contact.job_title}` : ''}`
							: (contact.job_title ?? undefined)}
						{contactFields}
						{companyFields}
						{contactForm}
						{clientOptions}
						bind:editDrawerOpen
						bind:timelineEvents
						emailMessages={emailTab.messages}
						emailEmptyState={emailTab.emptyState}
						mailboxConnected={emailTab.mailboxConnected}
						aiProviderConnected={emailTab.aiProviderConnected}
						smtpReady={emailTab.smtpReady}
						{role}
						{sharingId}
						documentsApi={api}
						documentsEntityId={contact.id}
						documentsReloadKey={session.cacheGeneration}
						onValidSubmit={onSaveContact}
						{onTimelineAdd}
						{onAddToTimeline}
						{onSendReply}
						{onDraftResponse}
						{onUseSuggestion}
						{onDiscardSuggestion}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="contact-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening contacts.
		</p>
	</div>
{/if}
