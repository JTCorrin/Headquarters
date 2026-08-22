<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage as sharedUserMessage } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toPaymentCreateBody,
		toPaymentListItem
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		paymentFormSchema,
		type PaymentBillOption,
		type PaymentClientOption,
		type PaymentInvoiceOption,
		type PaymentListItem,
		type PaymentVendorOption
	} from '$lib/schemas/payment.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import PaymentsListPage from './payments-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface PaymentsPageProps {
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
	}: PaymentsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<PaymentListItem[]>([]);
	let clientOptions = $state<PaymentClientOption[]>([]);
	let vendorOptions = $state<PaymentVendorOption[]>([]);
	let invoiceOptions = $state<PaymentInvoiceOption[]>([]);
	let billOptions = $state<PaymentBillOption[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	const paymentForm = superForm(
		defaults(
			{
				direction: 'inbound' as const,
				clientId: '',
				clientName: '',
				vendorId: '',
				vendorName: '',
				invoiceId: '',
				billId: '',
				amount: '',
				currency: 'GBP' as const,
				method: 'bank' as const,
				occurredOn: todayIso(),
				reference: '',
				notes: ''
			},
			zod4(paymentFormSchema)
		),
		{
			validators: zod4(paymentFormSchema),
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
	const navGroups = $derived(appNavGroups('Payments', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		return sharedUserMessage(error, fallback, {
			conflictMessage: 'This payment changed elsewhere — reload and try again.'
		});
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
		vendorOptions = [];
		invoiceOptions = [];
		billOptions = [];
		drawerOpen = false;
		viewState = { kind: 'loading' };
	}

	function resetCreateForm() {
		const firstClient = clientOptions[0];
		paymentForm.form.set({
			direction: 'inbound',
			clientId: firstClient?.id ?? '',
			clientName: firstClient?.name ?? '',
			vendorId: '',
			vendorName: '',
			invoiceId: '',
			billId: '',
			amount: '',
			currency: 'GBP',
			method: 'bank',
			occurredOn: todayIso(),
			reference: '',
			notes: ''
		});
	}

	function partyNamesFor(payment: {
		direction: string;
		client_id: string | null;
		vendor_id: string | null;
	}) {
		return {
			clientName: clientOptions.find((c) => c.id === payment.client_id)?.name,
			vendorName: vendorOptions.find((v) => v.id === payment.vendor_id)?.name
		};
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening payments.'
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

			const [listed, clients, vendors, invoices, bills] = await Promise.all([
				api.payments.list({ limit: 50 }),
				api.clients.list({ limit: 100 }),
				api.vendors.list({ limit: 100 }),
				api.invoices.list({ limit: 100 }),
				api.bills.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			vendorOptions = vendors.data.map((v) => ({ id: v.id, name: v.name }));
			invoiceOptions = invoices.data.map((inv) => ({
				id: inv.id,
				number: inv.number,
				clientId: inv.client_id,
				currency: inv.currency,
				balanceDueCents: inv.balance_due_cents,
				status: inv.status
			}));
			billOptions = bills.data.map((bill) => ({
				id: bill.id,
				number: bill.number,
				vendorId: bill.vendor_id,
				currency: bill.currency,
				balanceDueCents: bill.balance_due_cents,
				status: bill.status
			}));

			rows = listed.data.map((payment) => toPaymentListItem(payment, partyNamesFor(payment)));
			if (clientOptions[0] && !get(paymentForm.form).clientId) {
				paymentForm.form.update((current) => ({
					...current,
					clientId: clientOptions[0]!.id,
					clientName: clientOptions[0]!.name
				}));
			}
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No payments yet — record your first payment.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load payments.')
			};
		}
	}

	async function onCreatePayment(): Promise<boolean> {
		const epoch = captureEpoch();
		const form = get(paymentForm.form);
		try {
			const created = await api.payments.create(toPaymentCreateBody(form));
			if (isStale(epoch)) return false;
			rows = [toPaymentListItem(created, partyNamesFor(created)), ...rows];
			viewState = { kind: 'ready' };
			resetCreateForm();
			drawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not record payment — try again.'),
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
	<div class={className} data-testid="payments-page">
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
				<PaymentsListPage
					{orgName}
					{navGroups}
					{rows}
					form={paymentForm}
					{clientOptions}
					{vendorOptions}
					{invoiceOptions}
					{billOptions}
					bind:drawerOpen
					onValidSubmit={onCreatePayment}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="payments-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening payments.
		</p>
	</div>
{/if}
