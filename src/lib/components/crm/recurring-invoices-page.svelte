<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		emptyRecurringInvoiceFormData,
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toRecurringInvoiceCreateBody,
		toRecurringInvoiceListItem
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		recurringInvoiceFormSchema,
		type RecurringInvoiceClientOption,
		type RecurringInvoiceContactOption,
		type RecurringInvoiceListItem
	} from '$lib/schemas/recurring-invoice.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import RecurringInvoicesListPage from './recurring-invoices-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface RecurringInvoicesPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onCreated?: (scheduleId: string) => void;
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
	}: RecurringInvoicesPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<RecurringInvoiceListItem[]>([]);
	let clientOptions = $state<RecurringInvoiceClientOption[]>([]);
	let contactOptions = $state<RecurringInvoiceContactOption[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

	const scheduleForm = superForm(
		defaults(emptyRecurringInvoiceFormData(), zod4(recurringInvoiceFormSchema)),
		{
			validators: zod4(recurringInvoiceFormSchema),
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
	const navGroups = $derived(appNavGroups('Recurring', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isPreconditionFailed) {
				return error.message || 'Schedule changed elsewhere — reload and try again.';
			}
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
		drawerOpen = false;
		viewState = { kind: 'loading' };
	}

	function resetCreateForm() {
		const firstClient = clientOptions[0];
		scheduleForm.form.set({
			...emptyRecurringInvoiceFormData(),
			clientId: firstClient?.id ?? '00000000-0000-4000-8000-000000000000',
			clientName: firstClient?.name ?? ''
		});
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening recurring invoices.'
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
				api.recurringInvoiceSchedules.list({ limit: 50 }),
				api.clients.list({ limit: 100 }),
				api.contacts.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			const clientNameById = new Map(clients.data.map((c) => [c.id, c.name]));
			rows = listed.data.map((schedule) =>
				toRecurringInvoiceListItem(schedule, clientNameById.get(schedule.client_id) ?? '')
			);
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			contactOptions = contacts.data.map((c) => ({
				id: c.id,
				label: c.display_name || c.primary_email || c.id,
				clientId: c.client_id ?? null
			}));
			if (clientOptions[0] && get(scheduleForm.form).clientId.startsWith('00000000')) {
				scheduleForm.form.update((current) => ({
					...current,
					clientId: clientOptions[0]!.id,
					clientName: clientOptions[0]!.name
				}));
			}
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No recurring schedules yet — create your first one.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load recurring schedules.')
			};
		}
	}

	async function onCreateSchedule(): Promise<boolean> {
		const epoch = captureEpoch();
		const form = get(scheduleForm.form);
		try {
			const created = await api.recurringInvoiceSchedules.create(
				toRecurringInvoiceCreateBody(form, [])
			);
			if (isStale(epoch)) return false;
			rows = [
				toRecurringInvoiceListItem(created, form.clientName ?? ''),
				...rows
			];
			viewState = { kind: 'ready' };
			resetCreateForm();
			drawerOpen = false;
			onCreated?.(created.id);
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create schedule — try again.'),
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
	<div class={className} data-testid="recurring-invoices-page">
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
				<RecurringInvoicesListPage
					{orgName}
					{navGroups}
					{rows}
					form={scheduleForm}
					{clientOptions}
					{contactOptions}
					bind:drawerOpen
					onValidSubmit={onCreateSchedule}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="recurring-invoices-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening recurring invoices.
		</p>
	</div>
{/if}
