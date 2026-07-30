<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContactsListPage from '$lib/components/crm/contacts-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'CRM/Pages/ContactsList',
		component: ContactsListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});

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
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { contactFormSchema } from '$lib/schemas/contact.js';

	const data = defaults(
		{
			name: '',
			email: '',
			phone: '',
			company: '',
			title: '',
			status: 'contact'
		},
		zod4(contactFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(contactFormSchema),
		SPA: true,
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<ContactsListPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Contacts')}
				{rows}
				{form}
			/>
		</div>
	{/snippet}
</Story>
