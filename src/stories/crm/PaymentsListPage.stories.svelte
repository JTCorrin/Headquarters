<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PaymentsListPage from '$lib/components/crm/payments-list-page.svelte';

	const rows = [
		{
			id: '1',
			client: 'Northwind',
			invoiceNumber: 'INV-0881',
			amount: '£2,000.00',
			method: 'Card',
			status: 'Matched',
			receivedOn: '2026-03-18'
		},
		{
			id: '2',
			client: 'Contoso',
			invoiceNumber: 'INV-0875',
			amount: '£4,500.00',
			method: 'Bank',
			status: 'Matched',
			receivedOn: '2026-02-03'
		},
		{
			id: '3',
			client: 'Fabrikam',
			invoiceNumber: '',
			amount: '£750.00',
			method: 'Bank',
			status: 'Unallocated',
			receivedOn: '2026-03-20'
		},
		{
			id: '4',
			client: 'Litware',
			invoiceNumber: 'INV-0890',
			amount: '£1,200.00',
			method: 'Cash',
			status: 'Pending',
			receivedOn: '2026-03-22'
		},
		{
			id: '5',
			client: 'Adventure Works',
			invoiceNumber: 'INV-0860',
			amount: '£9,800.00',
			method: 'Card',
			status: 'Refunded',
			receivedOn: '2026-01-15'
		},
		{
			id: '6',
			client: 'Northwind',
			invoiceNumber: 'INV-0881',
			amount: '£2,200.00',
			method: 'Bank',
			status: 'Pending',
			receivedOn: '2026-03-25'
		}
	];

	const { Story } = defineMeta({
		title: 'CRM/Pages/PaymentsList',
		component: PaymentsListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { paymentFormSchema } from '$lib/schemas/payment.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const data = defaults(
		{
			clientName: '',
			invoiceNumber: '',
			amount: '',
			currency: 'GBP',
			method: 'bank',
			receivedOn: '',
			reference: '',
			status: 'pending'
		},
		zod4(paymentFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(paymentFormSchema),
		SPA: true,
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<PaymentsListPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Payments')}
				{rows}
				{form}
			/>
		</div>
	{/snippet}
</Story>
