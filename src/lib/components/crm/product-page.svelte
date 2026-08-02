<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		membershipFromCreateResult,
		productStatusLabel,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toProductFormData,
		toProductUpdateBody
	} from '$lib/api/v1/mappers.js';
	import type { ApiProduct } from '$lib/api/v1/types.js';
	import { centsToAmountString } from '$lib/money.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { productFormSchema, type ProductFormData } from '$lib/schemas/product.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { InfoCardField } from './info-card.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import ProductDetailPage from './product-detail-page.svelte';
	import ProductFormDrawer from './product-form-drawer.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ProductPageProps {
		api: ApiV1Client;
		session: OrgSession;
		productId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		productId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: ProductPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let product = $state<ApiProduct | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let editOpen = $state(false);

	const emptyProductForm = (): ProductFormData => ({
		sku: '',
		name: '',
		description: '',
		unitPrice: '',
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

	const detailFields = $derived<InfoCardField[]>(
		product
			? [
					{ label: 'SKU', value: product.sku },
					{ label: 'Type', value: product.product_type },
					{
						label: 'Unit price',
						value: `${centsToAmountString(product.unit_price_cents) || '0'} ${product.currency}`
					},
					{ label: 'Unit', value: product.unit_name ?? '—' }
				]
			: []
	);

	const inventoryFields = $derived<InfoCardField[]>(
		product?.track_stock
			? [
					{ label: 'Stock qty', value: String(product.stock_qty) },
					{
						label: 'Low stock at',
						value: product.low_stock_at != null ? String(product.low_stock_at) : '—'
					}
				]
			: [{ label: 'Inventory', value: 'Not tracked' }]
	);

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Product not found.';
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
		productId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		productId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.productId = productId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			productId: liveEpoch.productId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.productId !== liveEpoch.productId
		);
	}

	function resetOrgScopedState() {
		product = null;
		editOpen = false;
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

			const result = await api.products.get(productId);
			if (isStale(epoch)) return;
			product = result.data;
			productForm.form.set(toProductFormData(result.data));
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			product = null;
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'not_found', message: 'Product not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load product.')
			};
		}
	}

	async function onSaveProduct(): Promise<boolean> {
		if (!product) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.products.update(
				product.id,
				toProductUpdateBody(get(productForm.form)),
				product.version
			);
			if (isStale(epoch)) return false;
			product = updated;
			productForm.form.set(toProductFormData(updated));
			editOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Product changed elsewhere — reload and try again.')
				};
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save product — try again.'),
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
		void productId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="product-page">
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
				{:else if product}
					<ProductDetailPage
						{orgName}
						{navGroups}
						sku={product.sku}
						name={product.name}
						status={productStatusLabel(product.status)}
						description={product.description ?? undefined}
						{detailFields}
						{inventoryFields}
						showNav={false}
						class="min-h-0 flex-1"
						onEdit={() => {
							productForm.form.set(toProductFormData(product!));
							editOpen = true;
						}}
					/>
					<ProductFormDrawer
						bind:open={editOpen}
						form={productForm}
						title="Edit product"
						description="Update catalog details. Stock changes use adjust-stock."
						submitLabel="Save changes"
						showTrigger={false}
						onValidSubmit={onSaveProduct}
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="product-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening products.
		</p>
	</div>
{/if}
