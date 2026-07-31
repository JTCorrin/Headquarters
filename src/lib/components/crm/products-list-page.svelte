<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProductFormData } from '$lib/schemas/product.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ProductsTable from './products-table.svelte';
	import type { ProductRow } from './products-columns.js';
	import ProductFormDrawer from './product-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProductsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: ProductRow[];
		form: SuperForm<ProductFormData>;
		drawerOpen?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		drawerOpen = $bindable(false),
		class: className
	}: ProductsListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Headquarters"
				title="Products"
				description="Catalog and inventory for quote and invoice lines."
			>
				{#snippet actions()}
					<ProductFormDrawer bind:open={drawerOpen} {form}>
						{#snippet trigger()}
							<Button type="button" size="sm">New product</Button>
						{/snippet}
					</ProductFormDrawer>
				{/snippet}
			</PageHeader>

			<ProductsTable {rows} />
		</div>
	</main>
</div>
