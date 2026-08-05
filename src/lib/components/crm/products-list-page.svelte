<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProductFormData, ProductTaxRateOption } from '$lib/schemas/product.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ProductsTable from './products-table.svelte';
	import type { ProductRow } from './products-columns.js';
	import ProductFormDrawer from './product-form-drawer.svelte';
	import StatCard from './stat-card.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProductsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: ProductRow[];
		form: SuperForm<ProductFormData>;
		taxRateOptions?: ProductTaxRateOption[];
		drawerOpen?: boolean;
		viewState?: ResourceViewState;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		taxRateOptions = [],
		drawerOpen = $bindable(false),
		viewState = { kind: 'ready' },
		showNav = true,
		class: className,
		onReload,
		onValidSubmit
	}: ProductsListPageProps = $props();

	const activeCount = $derived(rows.filter((r) => r.status.toLowerCase() === 'active').length);
	const trackedCount = $derived(rows.filter((r) => r.stock !== undefined).length);
	const lowStockCount = $derived(
		rows.filter(
			(r) =>
				r.stock !== undefined && r.lowStockAt !== undefined && r.stock <= r.lowStockAt
		).length
	);
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="shrink-0" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			{#if viewState.kind === 'empty' || viewState.kind === 'validation'}
				<ResourceStateBanner state={viewState} onReload={onReload} />
			{/if}

			<PageHeader title="Products">
				{#snippet actions()}
					<ProductFormDrawer bind:open={drawerOpen} {form} {taxRateOptions} {onValidSubmit}>
						{#snippet trigger()}
							<Button type="button" size="sm">New product</Button>
						{/snippet}
					</ProductFormDrawer>
				{/snippet}
			</PageHeader>

			<div class="grid gap-3 sm:grid-cols-3">
				<StatCard label="Active" value={String(activeCount)} hint="Sellable in catalog" />
				<StatCard label="Tracked stock" value={String(trackedCount)} hint="Inventory on" />
				<StatCard
					label="Low stock"
					value={String(lowStockCount)}
					hint={lowStockCount ? 'Needs reorder attention' : 'All good'}
				/>
			</div>

			<ProductsTable {rows} />
		</div>
	</main>
</div>
