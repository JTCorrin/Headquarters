<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import InvoiceDetailPage from '$lib/components/crm/invoice-detail-page.svelte';

	const catalog = [
		{ id: 'p1', sku: 'RET-M', name: 'Monthly retainer', unitPrice: '4200.00' },
		{ id: 'p2', sku: 'IMP-D', name: 'Implementation day', unitPrice: '950.00' },
		{ id: 'p3', sku: 'SUP-H', name: 'Support hour', unitPrice: '120.00' }
	];

	const { Story } = defineMeta({
		title: 'CRM/Pages/InvoiceDetail',
		component: InvoiceDetailPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { invoiceFormSchema } from '$lib/schemas/invoice.js';
	import { lineItemFormSchema } from '$lib/schemas/line-item.js';
	import type { LineItemRow } from '$lib/components/crm/line-items-table.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const invoiceData = defaults(
		{
			clientName: 'Northwind',
			number: 'INV-0881',
			currency: 'GBP',
			dueOn: '2026-04-01',
			status: 'sent'
		},
		zod4(invoiceFormSchema)
	);

	const invoiceForm = superForm(invoiceData, {
		validators: zod4(invoiceFormSchema),
		SPA: true,
		resetForm: false
	});

	let lines = $state<LineItemRow[]>([
		{
			id: 'l1',
			productSku: 'RET-M',
			description: 'Monthly retainer',
			qty: '1',
			unitPrice: '4200.00',
			total: '4200.00'
		},
		{
			id: 'l2',
			productSku: 'SUP-H',
			description: 'Support hour',
			qty: '4',
			unitPrice: '120.00',
			total: '480.00'
		}
	]);
	let lineDrawerOpen = $state(false);

	const lineData = defaults(
		{ productId: '', description: '', qty: '1', unitPrice: '' },
		zod4(lineItemFormSchema)
	);

	const lineForm = superForm(lineData, {
		validators: zod4(lineItemFormSchema),
		SPA: true,
		resetForm: true,
		onUpdate({ form }) {
			if (!form.valid) return;
			const d = form.data;
			const product = catalog.find((p) => p.id === d.productId);
			const qty = Number(d.qty) || 0;
			const unit = Number(d.unitPrice) || 0;
			lines = [
				...lines,
				{
					id: crypto.randomUUID(),
					productSku: product?.sku,
					description: d.description,
					qty: d.qty,
					unitPrice: d.unitPrice,
					total: (qty * unit).toFixed(2)
				}
			];
			lineDrawerOpen = false;
		}
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<InvoiceDetailPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Invoices')}
				title="INV-0881 · Northwind"
				status="Sent"
				{invoiceForm}
				{lineForm}
				products={catalog}
				bind:lines
				bind:lineDrawerOpen
				onRemoveLine={(id) => {
					lines = lines.filter((row) => row.id !== id);
				}}
			/>
		</div>
	{/snippet}
</Story>
