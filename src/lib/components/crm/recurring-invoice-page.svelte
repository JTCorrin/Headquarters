<script lang="ts">
	import { fromStore, get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		emptyRecurringInvoiceFormData,
		membershipFromCreateResult,
		recurringInvoiceStatusLabel,
		recurringLineRowsFromDocument,
		roleFromMemberships,
		toCatalogProductOption,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toRecurringInvoiceFormData,
		toRecurringInvoiceRunListItem,
		toRecurringInvoiceUpdateBody,
		toRecurringLineInput,
		type RecurringLineRow
	} from '$lib/api/v1/mappers.js';
	import type { ApiRecurringInvoiceDocument } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		recurringInvoiceFormSchema,
		recurringLineFormSchema,
		type RecurringInvoiceClientOption,
		type RecurringInvoiceContactOption,
		type RecurringInvoiceRunListItem
	} from '$lib/schemas/recurring-invoice.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import RecurringInvoiceDetailPage from './recurring-invoice-detail-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface RecurringInvoicePageProps {
		api: ApiV1Client;
		session: OrgSession;
		scheduleId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onDeleted?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		scheduleId,
		onMissingOrg,
		onSwitchNavigate,
		onDeleted,
		onLogout,
		class: className
	}: RecurringInvoicePageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let schedule = $state<ApiRecurringInvoiceDocument | null>(null);
	let clientOptions = $state<RecurringInvoiceClientOption[]>([]);
	let contactOptions = $state<RecurringInvoiceContactOption[]>([]);
	let products = $state<ReturnType<typeof toCatalogProductOption>[]>([]);
	let lines = $state<RecurringLineRow[]>([]);
	let runs = $state<RecurringInvoiceRunListItem[]>([]);
	let savedFingerprint = $state('');
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let actionPending = $state(false);
	let actionError = $state<string | null>(null);
	let lineDrawerOpen = $state(false);

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

	const lineForm = superForm(
		defaults(
			{ productId: '', descriptionTemplate: '', qty: '1', unitPrice: '0', taxRatePercent: '' },
			zod4(recurringLineFormSchema)
		),
		{
			validators: zod4(recurringLineFormSchema),
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
	const isEditable = $derived(
		schedule?.status === 'draft' || schedule?.status === 'paused'
	);
	const title = $derived(schedule?.name ?? 'Recurring schedule');
	const statusLabel = $derived(
		schedule ? recurringInvoiceStatusLabel(schedule.status) : 'Draft'
	);
	const nextRunAt = $derived(
		schedule?.next_run_at
			? new Date(schedule.next_run_at).toLocaleString(undefined, {
					dateStyle: 'medium',
					timeStyle: 'short'
				})
			: null
	);

	function fingerprintFrom(form: ReturnType<typeof toRecurringInvoiceFormData>, rowLines: RecurringLineRow[]) {
		return JSON.stringify({ form, lines: rowLines });
	}

	const isDirty = $derived.by(() => {
		if (!schedule || !isEditable || !savedFingerprint) return false;
		return (
			fingerprintFrom(formSnapshot.current, lines) !==
			fingerprintFrom(toRecurringInvoiceFormData(schedule), recurringLineRowsFromDocument(schedule))
		);
	});

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Schedule not found.';
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
		scheduleId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		scheduleId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.scheduleId = scheduleId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			scheduleId: liveEpoch.scheduleId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.scheduleId !== liveEpoch.scheduleId
		);
	}

	function resetOrgScopedState() {
		schedule = null;
		lines = [];
		runs = [];
		clientOptions = [];
		contactOptions = [];
		products = [];
		savedFingerprint = '';
		actionError = null;
		viewState = { kind: 'loading' };
	}

	function applyDocument(document: ApiRecurringInvoiceDocument) {
		schedule = document;
		const formData = toRecurringInvoiceFormData(
			document,
			clientOptions.find((c) => c.id === document.client_id)?.name ?? ''
		);
		scheduleForm.form.set(formData);
		const mapped = recurringLineRowsFromDocument(document);
		lines = mapped;
		savedFingerprint = fingerprintFrom(formData, mapped);
	}

	async function loadRuns(epoch: RequestEpoch) {
		const listed = await api.recurringInvoiceSchedules.listRuns(scheduleId, { limit: 50 });
		if (isStale(epoch)) return;
		runs = listed.data.map(toRecurringInvoiceRunListItem);
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
		actionError = null;
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const [document, clients, contacts, productList] = await Promise.all([
				api.recurringInvoiceSchedules.get(scheduleId),
				api.clients.list({ limit: 100 }),
				api.contacts.list({ limit: 100 }),
				api.products.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			contactOptions = contacts.data.map((c) => ({
				id: c.id,
				label: c.display_name || c.primary_email || c.id,
				clientId: c.client_id ?? null
			}));
			products = productList.data.map(toCatalogProductOption);
			applyDocument(document.data);
			await loadRuns(epoch);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'forbidden', message: 'Schedule not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load schedule.')
			};
		}
	}

	async function persistSchedule(): Promise<boolean> {
		if (!schedule) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.recurringInvoiceSchedules.update(
				scheduleId,
				toRecurringInvoiceUpdateBody(get(scheduleForm.form), lines),
				schedule.version
			);
			if (isStale(epoch)) return false;
			applyDocument(updated);
			actionError = null;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			actionError = userMessage(error, 'Could not save schedule.');
			return false;
		}
	}

	async function runLifecycle(
		action: (version: number) => Promise<ApiRecurringInvoiceDocument>
	): Promise<void> {
		if (!schedule) return;
		const epoch = captureEpoch();
		actionPending = true;
		actionError = null;
		try {
			const updated = await action(schedule.version);
			if (isStale(epoch)) return;
			applyDocument(updated);
			await loadRuns(epoch);
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Command failed.');
		} finally {
			actionPending = false;
		}
	}

	async function onRunNow(): Promise<void> {
		if (!schedule) return;
		const epoch = captureEpoch();
		actionPending = true;
		actionError = null;
		try {
			await api.recurringInvoiceSchedules.runNow(scheduleId, schedule.version);
			if (isStale(epoch)) return;
			await loadRuns(epoch);
			const refreshed = await api.recurringInvoiceSchedules.get(scheduleId);
			if (isStale(epoch)) return;
			applyDocument(refreshed.data);
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Run now failed.');
		} finally {
			actionPending = false;
		}
	}

	async function onDelete(): Promise<void> {
		if (!schedule) return;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			await api.recurringInvoiceSchedules.delete(scheduleId, schedule.version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Could not delete draft.');
		} finally {
			actionPending = false;
		}
	}

	function onRemoveLine(id: string) {
		lines = lines.filter((row) => row.id !== id);
	}

	async function onAddLine(): Promise<boolean> {
		const id =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `line-${Date.now()}`;
		const data = get(lineForm.form);
		try {
			toRecurringLineInput(data);
		} catch {
			actionError = 'Invalid line values.';
			return false;
		}
		lines = [
			...lines,
			{
				id,
				productId: data.productId || null,
				descriptionTemplate: data.descriptionTemplate,
				qty: data.qty,
				unitPrice: data.unitPrice,
				taxRatePercent: data.taxRatePercent || '0'
			}
		];
		lineForm.form.set({
			productId: '',
			descriptionTemplate: '',
			qty: '1',
			unitPrice: '0',
			taxRatePercent: ''
		});
		lineDrawerOpen = false;
		return true;
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
		void scheduleId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="recurring-invoice-page">
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
				{/if}
				{#if schedule && viewState.kind === 'ready'}
					<RecurringInvoiceDetailPage
						{orgName}
						{navGroups}
						{title}
						status={statusLabel}
						{scheduleForm}
						{lineForm}
						{products}
						bind:lines
						{runs}
						bind:lineDrawerOpen
						{clientOptions}
						{contactOptions}
						{nextRunAt}
						{isEditable}
						{isDirty}
						{actionPending}
						{actionError}
						{onRemoveLine}
						{onAddLine}
						onSaveSchedule={persistSchedule}
						onActivate={() => runLifecycle((v) => api.recurringInvoiceSchedules.activate(scheduleId, v))}
						onPause={() => runLifecycle((v) => api.recurringInvoiceSchedules.pause(scheduleId, v))}
						onResume={() => runLifecycle((v) => api.recurringInvoiceSchedules.resume(scheduleId, v))}
						onCancel={() => runLifecycle((v) => api.recurringInvoiceSchedules.cancel(scheduleId, v))}
						onRunNow={onRunNow}
						onDelete={onDelete}
						onReload={loadAll}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="recurring-invoice-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening recurring invoices.
		</p>
	</div>
{/if}
