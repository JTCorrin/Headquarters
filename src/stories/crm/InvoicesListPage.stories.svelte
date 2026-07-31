<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import InvoicesListPage from '$lib/components/crm/invoices-list-page.svelte';

	const rows = [
		{
			id: '1',
			number: 'INV-0881',
			client: 'Northwind',
			total: '£4,200.00',
			status: 'Paid',
			dueOn: '2026-03-01'
		},
		{
			id: '2',
			number: 'INV-0882',
			client: 'Contoso',
			total: '£1,800.00',
			status: 'Sent',
			dueOn: '2026-03-20'
		},
		{
			id: '3',
			number: 'INV-0883',
			client: 'Fabrikam',
			total: '£960.00',
			status: 'Overdue',
			dueOn: '2026-02-28'
		},
		{
			id: '4',
			number: 'INV-0884',
			client: 'Litware',
			total: '£12,400.00',
			status: 'Partial',
			dueOn: '2026-04-01'
		},
		{
			id: '5',
			number: 'INV-0885',
			client: 'Adventure Works',
			total: '£2,100.00',
			status: 'Draft',
			dueOn: '2026-04-15'
		},
		{
			id: '6',
			number: 'INV-0886',
			client: 'Northwind',
			total: '£750.00',
			status: 'Sent',
			dueOn: '2026-04-10'
		},
		{
			id: '7',
			number: 'INV-0887',
			client: 'Contoso',
			total: '£3,300.00',
			status: 'Paid',
			dueOn: '2026-02-10'
		},
		{
			id: '8',
			number: 'INV-0888',
			client: 'Fabrikam',
			total: '£420.00',
			status: 'Void',
			dueOn: '2026-01-30'
		},
		{
			id: '9',
			number: 'INV-0889',
			client: 'Litware',
			total: '£5,000.00',
			status: 'Sent',
			dueOn: '2026-05-01'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/InvoicesList',
		component: InvoicesListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { invoiceFormSchema } from '$lib/schemas/invoice.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const data = defaults(
		{
			clientName: '',
			number: '',
			currency: 'GBP',
			dueOn: '',
			status: 'draft'
		},
		zod4(invoiceFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(invoiceFormSchema),
		SPA: true,
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<InvoicesListPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Invoices')}
				{rows}
				{form}
			/>
		</div>
	{/snippet}
</Story>
