<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProductDetailPage from '$lib/components/crm/product-detail-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/ProductDetail',
		component: ProductDetailPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Products'),
			sku: 'HW-HUB-01',
			name: 'Network hub',
			status: 'Active',
			description: 'Edge hub for warehouse sites — tracked stock, used on hardware quotes.',
			detailFields: [
				{ label: 'SKU', value: 'HW-HUB-01' },
				{ label: 'Category', value: 'Hardware' },
				{ label: 'Unit price', value: '£189.00' },
				{ label: 'Billing', value: 'One-off' }
			],
			inventoryFields: [
				{ label: 'Track stock', value: 'Yes' },
				{ label: 'On hand', value: '4' },
				{ label: 'Low stock at', value: '8' },
				{ label: 'Reorder hint', value: 'Low — reorder soon' }
			],
			stats: [
				{ label: 'Open quotes', value: '2', hint: 'Lines with this SKU' },
				{ label: 'Open invoices', value: '1', hint: 'Unpaid docs' },
				{ label: 'Units quoted', value: '14', hint: 'YTD' }
			],
			usage: [
				{
					id: 'u1',
					kind: 'quote',
					label: 'Q-0152 · Warehouse kit',
					clientName: 'Northwind',
					qty: '6',
					amount: '£1,134.00',
					status: 'Sent'
				},
				{
					id: 'u2',
					kind: 'quote',
					label: 'Q-0148 · Contoso pilot',
					clientName: 'Contoso',
					qty: '4',
					amount: '£756.00',
					status: 'Draft'
				},
				{
					id: 'u3',
					kind: 'invoice',
					label: 'INV-0891',
					clientName: 'Fabrikam',
					qty: '2',
					amount: '£378.00',
					status: 'Part paid'
				}
			]
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/product-detail-page.svelte').ProductDetailPageProps} */ (
				args
			)}
		<div class="h-screen">
			<ProductDetailPage {...props} />
		</div>
	{/snippet}
</Story>
