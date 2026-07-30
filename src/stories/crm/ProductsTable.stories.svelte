<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProductsTable from '$lib/components/crm/products-table.svelte';

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
		},
		{
			id: '4',
			sku: 'HW-OLD',
			name: 'Legacy modem',
			unitPrice: '£49.00',
			stock: 0,
			status: 'Archived'
		},
		{
			id: '5',
			sku: 'SVC-SETUP',
			name: 'Onboarding setup',
			unitPrice: '£950.00',
			status: 'Active'
		},
		{
			id: '6',
			sku: 'HW-CAM-02',
			name: 'Conference cam',
			unitPrice: '£320.00',
			stock: 12,
			status: 'Active'
		},
		{
			id: '7',
			sku: 'LIC-AI',
			name: 'AI assist add-on',
			unitPrice: '£29.00',
			stock: 999,
			status: 'Active'
		},
		{
			id: '8',
			sku: 'SVC-AUDIT',
			name: 'Security audit',
			unitPrice: '£2,400.00',
			status: 'Active'
		},
		{
			id: '9',
			sku: 'HW-DOCK',
			name: 'USB-C dock',
			unitPrice: '£149.00',
			stock: 8,
			status: 'Active'
		},
		{
			id: '10',
			sku: 'SVC-LEGACY',
			name: 'Legacy support',
			unitPrice: '£75.00',
			status: 'Archived'
		}
	];

	const { Story } = defineMeta({
		title: 'CRM/ProductsTable',
		component: ProductsTable,
		tags: ['autodocs']
	});
</script>

<Story name="Default" args={{ rows }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/products-table.svelte').ProductsTableProps} */ (args)}
		<div class="bg-background p-4">
			<ProductsTable {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ rows: [] }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/products-table.svelte').ProductsTableProps} */ (args)}
		<div class="bg-background p-4">
			<ProductsTable {...props} />
		</div>
	{/snippet}
</Story>
