<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		membershipFromCreateResult,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toQuoteCreateBody,
		toQuoteListItem
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		quoteFormSchema,
		type QuoteClientOption,
		type QuoteContactOption,
		type QuoteListItem
	} from '$lib/schemas/quote.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import QuotesListPage from './quotes-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface QuotesPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Preselect this client in the create drawer (`?client_id=`). */
		initialClientId?: string | null;
		/** Open the create drawer once load completes (`?new=1`). */
		openCreate?: boolean;
		onOpenCreateConsumed?: () => void;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		initialClientId = null,
		openCreate = false,
		onOpenCreateConsumed,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: QuotesPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<QuoteListItem[]>([]);
	let clientOptions = $state<QuoteClientOption[]>([]);
	let contactOptions = $state<QuoteContactOption[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

	const quoteForm = superForm(
		defaults(
			{
				clientId: '00000000-0000-4000-8000-000000000000',
				clientName: '',
				title: '',
				currency: 'GBP' as const,
				discount: '',
				status: 'draft' as const,
				recipients: []
			},
			zod4(quoteFormSchema)
		),
		{
			validators: zod4(quoteFormSchema),
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
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Quotes', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');


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
		clientOptions = [];
		contactOptions = [];
		drawerOpen = false;
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening quotes.'
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

			const [listed, clients, contacts] = await Promise.all([
				api.quotes.list({ limit: 50, status: 'draft' }),
				api.clients.list({ limit: 100 }),
				api.contacts.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			rows = listed.data.map(toQuoteListItem);
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			contactOptions = contacts.data.map((c) => ({
				id: c.id,
				label: c.display_name || c.primary_email || c.id,
				clientId: c.client_id ?? null
			}));
			const preferred =
				(initialClientId && clientOptions.find((c) => c.id === initialClientId)) ||
				(get(quoteForm.form).clientId.startsWith('00000000') ? clientOptions[0] : null);
			if (preferred) {
				quoteForm.form.update((current) => ({
					...current,
					clientId: preferred.id,
					clientName: preferred.name
				}));
			}
			if (openCreate) {
				drawerOpen = true;
				onOpenCreateConsumed?.();
			}
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No draft quotes yet — create your first quote.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load quotes.')
			};
		}
	}

	async function onCreateQuote(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.quotes.create(toQuoteCreateBody(get(quoteForm.form)));
			if (isStale(epoch)) return false;
			rows = [toQuoteListItem(created), ...rows];
			viewState = { kind: 'ready' };
			const firstClient = clientOptions[0];
			quoteForm.form.set({
				clientId: firstClient?.id ?? '00000000-0000-4000-8000-000000000000',
				clientName: firstClient?.name ?? '',
				title: '',
				currency: 'GBP',
				discount: '',
				status: 'draft',
				recipients: []
			});
			drawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create quote — try again.'),
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
	<div class={className} data-testid="quotes-page">
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
				<QuotesListPage
					{orgName}
					{navGroups}
					{rows}
					form={quoteForm}
					{clientOptions}
					{contactOptions}
					bind:drawerOpen
					onValidSubmit={onCreateQuote}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="quotes-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening quotes.
		</p>
	</div>
{/if}
