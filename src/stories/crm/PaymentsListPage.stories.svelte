<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PaymentsListPage from '$lib/components/crm/payments-list-page.svelte';

	const rows = [
		{
			id: '1',
			direction: 'Inbound',
			party: 'Northwind',
			allocationsSummary: 'INV-0881',
			amount: '£2,000.00',
			method: 'Card',
			status: 'Allocated',
			statusKey: 'allocated',
			occurredOn: '2026-03-18',
			version: 1
		},
		{
			id: '2',
			direction: 'Inbound',
			party: 'Contoso',
			allocationsSummary: 'INV-0875',
			amount: '£4,500.00',
			method: 'Bank',
			status: 'Allocated',
			statusKey: 'allocated',
			occurredOn: '2026-02-03',
			version: 1
		},
		{
			id: '3',
			direction: 'Inbound',
			party: 'Fabrikam',
			allocationsSummary: 'Unallocated',
			amount: '£750.00',
			method: 'Bank',
			status: 'Unallocated',
			statusKey: 'unallocated',
			occurredOn: '2026-03-20',
			version: 1
		},
		{
			id: '4',
			direction: 'Outbound',
			party: 'Cloudflare',
			allocationsSummary: 'BILL-0001',
			amount: '£1,200.00',
			method: 'Bank',
			status: 'Part Allocated',
			statusKey: 'part_allocated',
			occurredOn: '2026-03-22',
			version: 1
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/PaymentsList',
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
			direction: 'inbound',
			clientId: '11111111-2222-4333-8444-555555555555',
			clientName: 'Northwind',
			vendorId: '',
			vendorName: '',
			invoiceId: '',
			billId: '',
			amount: '',
			currency: 'GBP',
			method: 'bank',
			occurredOn: '',
			reference: '',
			notes: ''
		},
		zod4(paymentFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(paymentFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});

	const clientOptions = [{ id: '11111111-2222-4333-8444-555555555555', name: 'Northwind' }];
	const vendorOptions = [{ id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff', name: 'Cloudflare' }];
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<PaymentsListPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Payments')}
				{rows}
				{form}
				{clientOptions}
				{vendorOptions}
			/>
		</div>
	{/snippet}
</Story>
