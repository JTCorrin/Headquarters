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
		{@const props = /** @type {import('$lib/components/crm/contacts-table.svelte').ContactsTableProps} */ (args)}
		<div class="bg-background p-4">
			<ContactsTable {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ rows: [] }}>
	{#snippet template(args)}
		{@const props = /** @type {import('$lib/components/crm/contacts-table.svelte').ContactsTableProps} */ (args)}
		<div class="bg-background p-4">
			<ContactsTable {...props} />
		</div>
	{/snippet}
</Story>
