<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		membershipFromCreateResult,
		toClientCreateBody,
		toLeadCard,
		toLeadCreateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import { resolveLeadCurrency } from '$lib/money.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { clientFormSchema, type ClientFormData } from '$lib/schemas/client.js';
	import {
		leadFormSchema,
		type LeadClientOption,
		type LeadFormData
	} from '$lib/schemas/lead.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { LeadBoardMove, LeadCard } from './leads-board.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import ClientFormDrawer from './client-form-drawer.svelte';
	import LeadsBoardPage, { type LeadsViewMode } from './leads-board-page.svelte';
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
	let clientOptions = $state<LeadClientOption[]>([]);
	let orgCurrency = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);
	let clientDrawerOpen = $state(false);
	let moving = $state(false);
	let boardError = $state<string | null>(null);
	let viewMode = $state<LeadsViewMode>('board');

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
		clientOptions = [];
		orgCurrency = null;
		drawerOpen = false;
		clientDrawerOpen = false;
		boardError = null;
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
		boardError = null;
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const [listed, clientsListed, config] = await Promise.all([
				api.leads.list({ limit: 100 }),
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
			leadForm.form.set(emptyLeadForm(resolveLeadCurrency({ orgCurrency })));
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

	async function onMoveLead(move: LeadBoardMove) {
		if (moving) return;
		const previous = leads.map((l) => ({ ...l }));
		const target = leads.find((l) => l.id === move.id);
		if (!target || target.version == null) return;

		leads = leads.map((l) =>
			l.id === move.id ? { ...l, stage: move.stage, position: move.position } : l
		);
		boardError = null;
		moving = true;
		const epoch = captureEpoch();
		try {
			const updated = await api.leads.update(
				move.id,
				{ stage: move.stage, position: move.position },
				target.version
			);
			if (isStale(epoch)) return;
			leads = leads.map((l) => (l.id === move.id ? toLeadCard(updated) : l));
		} catch (error) {
			if (isStale(epoch)) return;
			leads = previous;
			boardError = userMessage(error, 'Could not move lead — board restored.');
		} finally {
			moving = false;
		}
	}

	function onMoveBlocked(message: string) {
		boardError = message;
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
					{clientOptions}
					{orgCurrency}
					{viewMode}
					bind:drawerOpen
					{viewState}
					{boardError}
					onReload={loadAll}
					onValidSubmit={onCreateLead}
					{onSelectLead}
					{onMoveLead}
					{onMoveBlocked}
					onViewModeChange={(mode) => {
						viewMode = mode;
					}}
					onCreateClient={() => {
						clientForm.form.set({
							...emptyClientForm(),
							defaultCurrency: orgCurrency ?? ''
						});
						clientDrawerOpen = true;
					}}
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
