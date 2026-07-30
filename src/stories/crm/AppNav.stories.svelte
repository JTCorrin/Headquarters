<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AppNav from '$lib/components/crm/app-nav.svelte';

	const { Story } = defineMeta({
		title: 'CRM/AppNav',
		component: AppNav,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		}
	});

	const groups = [
		{
			items: [
				{ label: 'Dashboard', href: '/', active: true },
				{ label: 'Contacts', href: '/contacts' },
				{ label: 'Leads', href: '/leads' },
				{ label: 'Clients', href: '/clients' }
			]
		},
		{
			label: 'Work',
			items: [
				{ label: 'Tasks', href: '/tasks' },
				{ label: 'Meetings', href: '/meetings' },
				{ label: 'Projects', href: '/projects' }
			]
		},
		{
			label: 'Money',
			items: [
				{ label: 'Quotes', href: '/quotes' },
				{ label: 'Invoices', href: '/invoices' },
				{ label: 'Payments', href: '/payments' }
			]
		},
		{
			label: 'Comms',
			items: [
				{ label: 'Email', href: '/email' },
				{ label: 'Documents', href: '/documents' }
			]
		}
	];
</script>

<div class="bg-background h-[720px]">
	<Story name="Default" args={{ orgName: 'Acme Org', groups }} />
</div>
