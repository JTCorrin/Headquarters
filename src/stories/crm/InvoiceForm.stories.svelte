<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import InvoiceFormDrawer from '$lib/components/crm/invoice-form-drawer.svelte';

	const { Story } = defineMeta({
		title: 'CRM/InvoiceForm',
		component: InvoiceFormDrawer,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { invoiceFormSchema } from '$lib/schemas/invoice.js';

	const data = defaults(
		{
			clientName: 'Northwind',
			number: 'INV-0900',
			currency: 'GBP',
			dueOn: '2026-04-01',
			status: 'draft'
		},
		zod4(invoiceFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(invoiceFormSchema),
		SPA: true,
		resetForm: false
	});

	let open = $state(true);
</script>

<Story name="Drawer">
	{#snippet template()}
		<div class="bg-background flex h-[640px] items-start justify-center p-8">
			<InvoiceFormDrawer bind:open {form} />
		</div>
	{/snippet}
</Story>
