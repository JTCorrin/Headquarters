<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProductsListPage from '$lib/components/crm/products-list-page.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/ProductsList',
		component: ProductsListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});

	const rows = [
		{
			id: '1',
			sku: 'SVC-RETAIN',
			name: 'Monthly retainer',
			category: 'Service',
			unitPrice: '£4,200.00',
			status: 'Active'
		},
		{
			id: '2',
			sku: 'HW-HUB-01',
			name: 'Network hub',
			category: 'Hardware',
			unitPrice: '£189.00',
			stock: 4,
			lowStockAt: 8,
			status: 'Active'
		},
		{
			id: '3',
			sku: 'LIC-SEAT',
			name: 'Seat licence',
			category: 'Licence',
			unitPrice: '£12.00',
			stock: 500,
			lowStockAt: 50,
			status: 'Active'
		},
		{
			id: '4',
			sku: 'SUP-H',
			name: 'Priority support',
			category: 'Service',
			unitPrice: '£90.00',
			status: 'Active'
		},
		{
			id: '5',
			sku: 'HW-CAB-10',
			name: 'Patch cable 10m',
			category: 'Hardware',
			unitPrice: '£18.00',
			stock: 2,
			lowStockAt: 10,
			status: 'Active'
		},
		{
			id: '6',
			sku: 'OLD-KIT',
			name: 'Legacy starter kit',
			category: 'Hardware',
			unitPrice: '£499.00',
			stock: 0,
			lowStockAt: 1,
			status: 'Archived'
		}
	];
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { productFormSchema } from '$lib/schemas/product.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const data = defaults(
		{
			sku: '',
			name: '',
			description: '',
			unitPrice: '',
			trackStock: false,
			stockQty: '',
			status: 'active'
		},
		zod4(productFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(productFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<ProductsListPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Products')}
				{rows}
				{form}
			/>
		</div>
	{/snippet}
</Story>
