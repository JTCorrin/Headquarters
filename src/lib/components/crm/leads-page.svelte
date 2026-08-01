<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		toLeadCard,
		toLeadCreateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { leadFormSchema, type LeadFormData } from '$lib/schemas/lead.js';
	import type { OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { LeadCard } from './leads-board.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import LeadsBoardPage from './leads-board-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface LeadsPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onSelectLead?: (id: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onSelectLead,
		onLogout,
		class: className
	}: LeadsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let leads = $state<LeadCard[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

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

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('Leads'));
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
		leads = [];
		drawerOpen = false;
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

			const listed = await api.leads.list({ limit: 100 });
			if (isStale(epoch)) return;

			leads = listed.data.map(toLeadCard);
			viewState =
				leads.length === 0
					? { kind: 'empty', message: 'No leads yet — create one to populate the board.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load leads.')
			};
		}
	}

	async function onCreateLead(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.leads.create(toLeadCreateBody(get(leadForm.form)));
			if (isStale(epoch)) return false;
			leads = [toLeadCard(created), ...leads];
			viewState = { kind: 'ready' };
			leadForm.form.set(emptyLeadForm());
			drawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create lead — try again.'),
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
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="leads-page">
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
				{#if viewState.kind !== 'ready' && viewState.kind !== 'empty'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{/if}
				<LeadsBoardPage
					{orgName}
					{navGroups}
					{leads}
					{leadForm}
					bind:drawerOpen
					{viewState}
					onReload={loadAll}
					onValidSubmit={onCreateLead}
					{onSelectLead}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="leads-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening leads.
		</p>
	</div>
{/if}
