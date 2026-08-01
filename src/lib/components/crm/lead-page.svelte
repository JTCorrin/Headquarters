<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		toClientResource,
		toLeadConvertBody,
		toLeadFormData,
		toLeadResource,
		toLeadUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiLead } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		convertLeadFormSchema,
		leadFormSchema,
		type LeadFormData,
		type LeadResource
	} from '$lib/schemas/lead.js';
	import type { OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { LeadConvertResult } from './lead-detail-page.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
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
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let convertOpen = $state(false);
	let converting = $state(false);
	let lastConvertResult = $state<LeadConvertResult | null>(null);

	const emptyLeadForm = (): LeadFormData => ({
		name: '',
		companyName: '',
		stage: 'new',
		valueCents: '',
		currency: 'GBP',
		probabilityPercent: '',
		source: '',
		expectedCloseOn: '',
		lostReason: '',
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

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('Leads'));
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
		lastConvertResult = null;
		convertOpen = false;
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

			const result = await api.leads.get(leadId);
			if (isStale(epoch)) return;

			lead = result.data;
			leadForm.form.set(toLeadFormData(result.data));
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			lead = null;
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
						{viewState}
						bind:convertOpen
						{converting}
						{lastConvertResult}
						{onSave}
						{onConvert}
						{onOpenClient}
						onReload={loadAll}
						showNav={false}
						class="min-h-0 flex-1"
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
