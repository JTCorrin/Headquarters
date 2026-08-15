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
		toClientRow,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { clientFormSchema, type ClientFormData } from '$lib/schemas/client.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { ClientRow } from './clients-columns.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import ClientsListPage from './clients-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ClientsPageProps {
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
	}: ClientsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<ClientRow[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

	const emptyClientForm = (): ClientFormData => ({
		name: '',
		status: 'active',
		websiteUrl: '',
		industry: '',
		primaryEmail: '',
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
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Clients', role));
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
		rows = [];
		drawerOpen = false;
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

			const listed = await api.clients.list({ limit: 50 });
			if (isStale(epoch)) return;

			rows = listed.data.map(toClientRow);
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No clients yet — create one or convert a lead.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load clients.')
			};
		}
	}

	async function onCreateClient(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.clients.create(toClientCreateBody(get(clientForm.form)));
			if (isStale(epoch)) return false;
			rows = [toClientRow(created), ...rows];
			viewState = { kind: 'ready' };
			clientForm.form.set(emptyClientForm());
			drawerOpen = false;
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
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="clients-page">
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
				<ClientsListPage
					{orgName}
					{navGroups}
					{rows}
					{clientForm}
					bind:drawerOpen
					{viewState}
					onReload={loadAll}
					onValidSubmit={onCreateClient}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="clients-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening clients.
		</p>
	</div>
{/if}
