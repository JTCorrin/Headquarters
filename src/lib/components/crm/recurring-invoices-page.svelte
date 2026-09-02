<script lang="ts">
	import { fromStore, get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage as sharedUserMessage } from '$lib/api/v1/errors.js';
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
	let contactsClientId = $state<string | null>(null);

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

	const formSnapshot = fromStore(scheduleForm.form);

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
		return sharedUserMessage(error, fallback, {
			conflictMessage: 'Schedule changed elsewhere — reload and try again.'
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

	function isPlaceholderClientId(clientId: string): boolean {
		return !clientId || clientId.startsWith('00000000');
	}

	function mapContactsForClient(
		contacts: Array<{ id: string; display_name: string; primary_email: string | null }>,
		clientId: string
	): RecurringInvoiceContactOption[] {
		return contacts.map((c) => ({
			id: c.id,
			label: c.display_name || c.primary_email || c.id,
			clientId
		}));
	}

	async function loadContactsForClient(clientId: string, epoch: RequestEpoch) {
		if (isPlaceholderClientId(clientId)) {
			contactOptions = [];
			contactsClientId = null;
			return;
		}
		const listed = await api.contacts.list({ client_id: clientId, limit: 100 });
		if (isStale(epoch)) return;
		const selectedIds = new Set(get(scheduleForm.form).recipients.map((r) => r.contactId));
		const mapped = mapContactsForClient(listed.data, clientId);
		const byId = new Map(mapped.map((c) => [c.id, c]));
		for (const existing of contactOptions) {
			if (selectedIds.has(existing.id) && !byId.has(existing.id)) {
				byId.set(existing.id, existing);
			}
		}
		contactOptions = [...byId.values()];
		contactsClientId = clientId;
	}

	function resetOrgScopedState() {
		rows = [];
		clientOptions = [];
		contactOptions = [];
		contactsClientId = null;
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

			const [listed, clients] = await Promise.all([
				api.recurringInvoiceSchedules.list({ limit: 50 }),
				api.clients.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			const clientNameById = new Map(clients.data.map((c) => [c.id, c.name]));
			rows = listed.data.map((schedule) =>
				toRecurringInvoiceListItem(schedule, clientNameById.get(schedule.client_id) ?? '')
			);
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			if (clientOptions[0] && get(scheduleForm.form).clientId.startsWith('00000000')) {
				scheduleForm.form.update((current) => ({
					...current,
					clientId: clientOptions[0]!.id,
					clientName: clientOptions[0]!.name
				}));
			}
			await loadContactsForClient(get(scheduleForm.form).clientId, epoch);
			if (isStale(epoch)) return;
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

	$effect(() => {
		const clientId = formSnapshot.current.clientId;
		if (!session.selectedOrgId || isPlaceholderClientId(clientId)) return;
		if (clientId === contactsClientId) return;
		const epoch = captureEpoch();
		void loadContactsForClient(clientId, epoch);
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
