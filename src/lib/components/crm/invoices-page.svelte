<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		toInvoiceCreateBody,
		toInvoiceListItem,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		invoiceFormSchema,
		type InvoiceClientOption,
		type InvoiceContactOption,
		type InvoiceListItem,
		type InvoiceQuoteOption
	} from '$lib/schemas/invoice.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import InvoicesListPage from './invoices-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface InvoicesPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onCreated?: (invoiceId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onCreated,
		onLogout,
		class: className
	}: InvoicesPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<InvoiceListItem[]>([]);
	let clientOptions = $state<InvoiceClientOption[]>([]);
	let contactOptions = $state<InvoiceContactOption[]>([]);
	let quoteOptions = $state<InvoiceQuoteOption[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function dueInDays(days: number): string {
		const d = new Date();
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	const invoiceForm = superForm(
		defaults(
			{
				clientId: '00000000-0000-4000-8000-000000000000',
				clientName: '',
				contactId: '',
				currency: 'GBP' as const,
				issueOn: todayIso(),
				dueOn: dueInDays(30),
				purchaseOrderNumber: '',
				status: 'draft' as const,
				quoteId: ''
			},
			zod4(invoiceFormSchema)
		),
		{
			validators: zod4(invoiceFormSchema),
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
	const navGroups = $derived(appNavGroups('Invoices'));
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
		clientOptions = [];
		contactOptions = [];
		quoteOptions = [];
		drawerOpen = false;
		viewState = { kind: 'loading' };
	}

	function resetCreateForm() {
		const firstClient = clientOptions[0];
		invoiceForm.form.set({
			clientId: firstClient?.id ?? '00000000-0000-4000-8000-000000000000',
			clientName: firstClient?.name ?? '',
			contactId: '',
			currency: 'GBP',
			issueOn: todayIso(),
			dueOn: dueInDays(30),
			purchaseOrderNumber: '',
			status: 'draft',
			quoteId: ''
		});
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening invoices.'
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

			const [listed, clients, contacts, quotes] = await Promise.all([
				api.invoices.list({ limit: 50 }),
				api.clients.list({ limit: 100 }),
				api.contacts.list({ limit: 100 }),
				api.quotes.list({ limit: 50 })
			]);
			if (isStale(epoch)) return;

			rows = listed.data.map(toInvoiceListItem);
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			contactOptions = contacts.data.map((c) => ({
				id: c.id,
				label: c.display_name || c.primary_email || c.id,
				clientId: c.client_id ?? null
			}));
			quoteOptions = quotes.data
				.filter((q) => q.status === 'accepted')
				.map((q) => ({
					id: q.id,
					label: `${q.number} · ${q.title}`
				}));
			if (clientOptions[0] && get(invoiceForm.form).clientId.startsWith('00000000')) {
				invoiceForm.form.update((current) => ({
					...current,
					clientId: clientOptions[0]!.id,
					clientName: clientOptions[0]!.name
				}));
			}
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No invoices yet — create your first invoice.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load invoices.')
			};
		}
	}

	async function onCreateInvoice(): Promise<boolean> {
		const epoch = captureEpoch();
		const form = get(invoiceForm.form);
		try {
			const created = form.quoteId
				? await api.quotes.createInvoice(form.quoteId)
				: await api.invoices.create(toInvoiceCreateBody(form));
			if (isStale(epoch)) return false;
			rows = [toInvoiceListItem(created), ...rows];
			viewState = { kind: 'ready' };
			resetCreateForm();
			drawerOpen = false;
			onCreated?.(created.id);
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create invoice — try again.'),
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
	<div class={className} data-testid="invoices-page">
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
				<InvoicesListPage
					{orgName}
					{navGroups}
					{rows}
					form={invoiceForm}
					{clientOptions}
					{contactOptions}
					{quoteOptions}
					bind:drawerOpen
					onValidSubmit={onCreateInvoice}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="invoices-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening invoices.
		</p>
	</div>
{/if}
