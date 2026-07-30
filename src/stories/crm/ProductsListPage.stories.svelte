<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProductsListPage from '$lib/components/crm/products-list-page.svelte';

	const { Story } = defineMeta({
		title: 'CRM/Pages/ProductsList',
		component: ProductsListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});

	const rows = [
		{
			id: '1',
			sku: 'SVC-RETAIN',
			name: 'Monthly retainer',
			unitPrice: '£4,200.00',
			status: 'Active'
		},
		{
			id: '2',
			sku: 'HW-HUB-01',
			name: 'Network hub',
			unitPrice: '£189.00',
			stock: 24,
			status: 'Active'
		},
		{
			id: '3',
			sku: 'LIC-SEAT',
			name: 'Seat licence',
			unitPrice: '£12.00',
			stock: 500,
			status: 'Active'
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
