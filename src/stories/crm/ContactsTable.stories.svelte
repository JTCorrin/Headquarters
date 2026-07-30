<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContactsTable from '$lib/components/crm/contacts-table.svelte';

	const rows = [
		{
			id: '1',
			name: 'Ava Chen',
			email: 'ava@northwind.com',
			company: 'Northwind',
			status: 'Client',
			owner: 'Joe'
		},
		{
			id: '2',
			name: 'Sam Ortiz',
			email: 'sam@contoso.io',
			company: 'Contoso',
			status: 'Lead',
			owner: 'Joe'
		},
		{
			id: '3',
			name: 'Riley Park',
			email: 'riley@example.com',
			status: 'Contact',
			owner: 'Maya'
		},
		{
			id: '4',
			name: 'Jordan Lee',
			email: 'jordan@fabrikam.com',
			company: 'Fabrikam',
			status: 'Lead',
			owner: 'Maya'
		},
		{
			id: '5',
			name: 'Casey Nguyen',
			email: 'casey@adventure.works',
			company: 'Adventure Works',
			status: 'Client',
			owner: 'Joe'
		},
		{
			id: '6',
			name: 'Morgan Blake',
			email: 'morgan@litware.io',
			company: 'Litware',
			status: 'Contact',
			owner: 'Maya'
		},
		{
			id: '7',
			name: 'Taylor Kim',
			email: 'taylor@northwind.com',
			company: 'Northwind',
			status: 'Client',
			owner: 'Joe'
		},
		{
			id: '8',
			name: 'Quinn Patel',
			email: 'quinn@contoso.io',
			company: 'Contoso',
			status: 'Lead',
			owner: 'Maya'
		},
		{
			id: '9',
			name: 'Jamie Brooks',
			email: 'jamie@example.com',
			status: 'Contact',
			owner: 'Joe'
		},
		{
			id: '10',
			name: 'Alex Rivera',
			email: 'alex@fabrikam.com',
			company: 'Fabrikam',
			status: 'Client',
			owner: 'Maya'
		}
	];

	const { Story } = defineMeta({
		title: 'CRM/ContactsTable',
		component: ContactsTable,
		tags: ['autodocs']
	});
</script>

<Story name="Default" args={{ rows }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/contacts-table.svelte').ContactsTableProps} */ (args)}
		<div class="bg-background p-4">
			<ContactsTable {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ rows: [] }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/contacts-table.svelte').ContactsTableProps} */ (args)}
		<div class="bg-background p-4">
			<ContactsTable {...props} />
		</div>
	{/snippet}
</Story>
