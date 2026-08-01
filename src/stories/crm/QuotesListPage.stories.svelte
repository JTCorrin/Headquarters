<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import QuotesListPage from '$lib/components/crm/quotes-list-page.svelte';

	const rows = [
		{
			id: '1',
			number: 'Q-0142',
			client: 'Northwind',
			total: '£4,200.00',
			status: 'Sent',
			validUntil: '2026-04-01'
		},
		{
			id: '2',
			number: 'Q-0143',
			client: 'Contoso',
			total: '£18,000.00',
			status: 'Draft',
			validUntil: '2026-04-15'
		},
		{
			id: '3',
			number: 'Q-0144',
			client: 'Fabrikam',
			total: '£6,500.00',
			status: 'Accepted',
			validUntil: '2026-03-20'
		},
		{
			id: '4',
			number: 'Q-0145',
			client: 'Litware',
			total: '£2,100.00',
			status: 'Expired',
			validUntil: '2026-02-01'
		},
		{
			id: '5',
			number: 'Q-0146',
			client: 'Adventure Works',
			total: '£9,800.00',
			status: 'Sent',
			validUntil: '2026-05-01'
		},
		{
			id: '6',
			number: 'Q-0147',
			client: 'Northwind',
			total: '£750.00',
			status: 'Draft',
			validUntil: '2026-04-30'
		},
		{
			id: '7',
			number: 'Q-0148',
			client: 'Contoso',
			total: '£3,300.00',
			status: 'Rejected',
			validUntil: '2026-03-01'
		},
		{
			id: '8',
			number: 'Q-0149',
			client: 'Fabrikam',
			total: '£12,400.00',
			status: 'Sent',
			validUntil: '2026-04-12'
		},
		{
			id: '9',
			number: 'Q-0150',
			client: 'Litware',
			total: '£1,050.00',
			status: 'Accepted',
			validUntil: '2026-04-08'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/QuotesList',
		component: QuotesListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { quoteFormSchema } from '$lib/schemas/quote.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const data = defaults(
		{
			clientId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			clientName: '',
			title: '',
			currency: 'GBP',
			status: 'draft'
		},
		zod4(quoteFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(quoteFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<QuotesListPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Quotes')}
				{rows}
				{form}
			/>
		</div>
	{/snippet}
</Story>
