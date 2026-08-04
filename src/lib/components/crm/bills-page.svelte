<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		membershipFromCreateResult,
		toBillCreateBody,
		toBillListItem,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toVendorCreateBody
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		billFormSchema,
		type BillListItem,
		type BillVendorOption
	} from '$lib/schemas/bill.js';
	import { vendorFormSchema } from '$lib/schemas/vendor.js';
	import { looksLikeVendorId } from '$lib/crm/entity-list-filter.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import BillsListPage from './bills-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface BillsPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Optional `vendor_id` list filter (deep-link / vendor AP views). */
		vendorId?: string | null;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onCreated?: (billId: string) => void;
		onVendorFilterChange?: (vendorId: string | null) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		vendorId = null,
		onMissingOrg,
		onSwitchNavigate,
		onCreated,
		onVendorFilterChange,
		onLogout,
		class: className
	}: BillsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<BillListItem[]>([]);
	let vendorOptions = $state<BillVendorOption[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);
	let vendorDrawerOpen = $state(false);

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function dueInDays(days: number): string {
		const d = new Date();
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	const billForm = superForm(
		defaults(
			{
				vendorId: '00000000-0000-4000-8000-000000000000',
				vendorName: '',
				number: '',
				internalReference: '',
				currency: 'GBP' as const,
				issueOn: '',
				receivedOn: todayIso(),
				dueOn: dueInDays(30),
				notes: '',
				status: 'draft' as const
			},
			zod4(billFormSchema)
		),
		{
			validators: zod4(billFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const vendorForm = superForm(
		defaults({ name: '' }, zod4(vendorFormSchema)),
		{
			validators: zod4(vendorFormSchema),
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
	const navGroups = $derived(appNavGroups('Bills', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const activeVendorId = $derived(looksLikeVendorId(vendorId) ? vendorId : null);
	const vendorFilterLabel = $derived.by(() => {
		if (!activeVendorId) return null;
		const name = vendorOptions.find((v) => v.id === activeVendorId)?.name;
		return name ? `Filtered by vendor: ${name}` : 'Filtered by vendor';
	});

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
		vendorId: string | null;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		vendorId: null
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.vendorId = activeVendorId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			vendorId: liveEpoch.vendorId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.vendorId !== liveEpoch.vendorId
		);
	}

	function resetOrgScopedState() {
		rows = [];
		vendorOptions = [];
		drawerOpen = false;
		vendorDrawerOpen = false;
		viewState = { kind: 'loading' };
	}

	function resetCreateForm() {
		const firstVendor = vendorOptions[0];
		billForm.form.set({
			vendorId: firstVendor?.id ?? '00000000-0000-4000-8000-000000000000',
			vendorName: firstVendor?.name ?? '',
			number: '',
			internalReference: '',
			currency: 'GBP',
			issueOn: '',
			receivedOn: todayIso(),
			dueOn: dueInDays(30),
			notes: '',
			status: 'draft'
		});
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening bills.'
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

			const [listed, vendors] = await Promise.all([
				api.bills.list({
					limit: 50,
					...(activeVendorId ? { vendor_id: activeVendorId } : {})
				}),
				api.vendors.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			rows = listed.data.map(toBillListItem);
			vendorOptions = vendors.data.map((v) => ({
				id: v.id,
				name: v.name,
				defaultCurrency: v.default_currency
			}));
			if (vendorOptions[0] && get(billForm.form).vendorId.startsWith('00000000')) {
				billForm.form.update((current) => ({
					...current,
					vendorId: vendorOptions[0]!.id,
					vendorName: vendorOptions[0]!.name
				}));
			}
			viewState =
				rows.length === 0
					? {
							kind: 'empty',
							message: activeVendorId
								? 'No bills for this vendor.'
								: 'No bills yet — create your first bill.'
						}
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load bills.')
			};
		}
	}

	async function onCreateBill(): Promise<boolean> {
		const epoch = captureEpoch();
		const form = get(billForm.form);
		try {
			const created = await api.bills.create(toBillCreateBody(form));
			if (isStale(epoch)) return false;
			rows = [toBillListItem(created), ...rows];
			viewState = { kind: 'ready' };
			resetCreateForm();
			drawerOpen = false;
			onCreated?.(created.id);
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create bill — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onCreateVendor(): Promise<boolean> {
		const epoch = captureEpoch();
		const data = get(vendorForm.form);
		try {
			const created = await api.vendors.create(toVendorCreateBody(data));
			if (isStale(epoch)) return false;
			vendorOptions = [
				...vendorOptions,
				{ id: created.id, name: created.name, defaultCurrency: created.default_currency }
			];
			billForm.form.update((current) => ({
				...current,
				vendorId: created.id,
				vendorName: created.name
			}));
			vendorForm.form.set({ name: '' });
			vendorDrawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create vendor — try again.'),
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
		void activeVendorId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="bills-page">
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
				<BillsListPage
					{orgName}
					{navGroups}
					{rows}
					form={billForm}
					vendorForm={vendorForm}
					{vendorOptions}
					selectedVendorId={activeVendorId}
					filterLabel={vendorFilterLabel}
					onVendorFilterChange={onVendorFilterChange}
					onClearFilter={
						activeVendorId && onVendorFilterChange
							? () => onVendorFilterChange(null)
							: undefined
					}
					bind:drawerOpen
					bind:vendorDrawerOpen
					onValidSubmit={onCreateBill}
					onValidVendorCreate={onCreateVendor}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="bills-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening bills.
		</p>
	</div>
{/if}
