<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ClientsListPage from '$lib/components/crm/clients-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const rows = [
		{
			id: '1',
			name: 'Northwind',
			status: 'Client',
			owner: 'Joe',
			openInvoices: '£2,200.00',
			pipeline: '£4,200 quoted'
		},
		{
			id: '2',
			name: 'Contoso',
			status: 'Client',
			owner: 'Maya',
			openInvoices: '£0.00',
			pipeline: '—'
		},
		{
			id: '3',
			name: 'Fabrikam',
			status: 'At risk',
			owner: 'Joe',
			openInvoices: '£6,500.00',
			pipeline: '£12,400 quoted'
		},
		{
			id: '4',
			name: 'Litware',
			status: 'Client',
			owner: 'Sam',
			openInvoices: '£1,050.00',
			pipeline: '£750 draft'
		},
		{
			id: '5',
			name: 'Adventure Works',
			status: 'Churned',
			owner: 'Maya',
			openInvoices: '£0.00',
			pipeline: '—'
		},
		{
			id: '6',
			name: 'Wide World Importers',
			status: 'Client',
			owner: 'Joe',
			openInvoices: '£18,000.00',
			pipeline: 'Annual renewal'
		}
	];

	const { Story } = defineMeta({
		title: 'CRM/Pages/ClientsList',
		component: ClientsListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Clients'),
			rows
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/clients-list-page.svelte').ClientsListPageProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientsListPage {...props} />
		</div>
	{/snippet}
</Story>
