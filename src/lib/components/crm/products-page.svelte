<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		membershipFromCreateResult,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toProductCreateBody,
		toProductRow
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		productFormSchema,
		type ProductCategoryOption,
		type ProductFormData,
		type ProductTaxRateOption
	} from '$lib/schemas/product.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { ProductRow } from './products-columns.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import ProductsListPage from './products-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ProductsPageProps {
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
	}: ProductsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<ProductRow[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

	let taxRateOptions = $state<ProductTaxRateOption[]>([]);
	let categoryOptions = $state<ProductCategoryOption[]>([]);

	const emptyProductForm = (): ProductFormData => ({
		sku: '',
		name: '',
		description: '',
		categoryId: '',
		unitPrice: '',
		taxRateId: '',
		trackStock: false,
		stockQty: '',
		status: 'active'
	});

	const productForm = superForm(defaults(emptyProductForm(), zod4(productFormSchema)), {
		validators: zod4(productFormSchema),
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
	const navGroups = $derived(appNavGroups('Products', role));
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
				message: 'Select an organisation before opening products.'
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

			const [listed, rates, categories] = await Promise.all([
				api.products.list({ limit: 100 }),
				api.taxRates.list({ limit: 100 }),
				api.productCategories.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			taxRateOptions = rates
				.filter((r) => r.active && !r.deleted_at)
				.map((r) => ({
					id: r.id,
					label: `${r.name} (${r.rate_percent}%)${r.is_default ? ' · default' : ''}`
				}));
			categoryOptions = categories.data
				.filter((c) => !c.deleted_at)
				.map((c) => ({ id: c.id, label: c.name }));
			const categoryNameById = new Map(categoryOptions.map((c) => [c.id, c.label]));
			rows = listed.data.map((product) =>
				toProductRow(
					product,
					product.category_id ? categoryNameById.get(product.category_id) : undefined
				)
			);
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No products yet — create a catalog item to quote.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load products.')
			};
		}
	}

	async function onCreateProduct(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const form = get(productForm.form);
			let created = await api.products.create(toProductCreateBody(form));
			const openingQty = form.trackStock ? Number(form.stockQty || '0') : 0;
			if (form.trackStock && Number.isFinite(openingQty) && openingQty > 0) {
				created = await api.products.adjustStock(created.id, {
					quantity_delta: openingQty,
					reason: 'opening'
				});
			}
			if (isStale(epoch)) return false;
			rows = [toProductRow(created), ...rows];
			viewState = { kind: 'ready' };
			productForm.form.set(emptyProductForm());
			drawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create product — try again.'),
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
	<div class={className} data-testid="products-page">
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
				{#if viewState.kind !== 'ready' && viewState.kind !== 'empty' && viewState.kind !== 'validation'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{/if}
				<ProductsListPage
					{orgName}
					{navGroups}
					{rows}
					form={productForm}
					{taxRateOptions}
					{categoryOptions}
					bind:drawerOpen
					{viewState}
					onReload={loadAll}
					onValidSubmit={onCreateProduct}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="products-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening products.
		</p>
	</div>
{/if}
