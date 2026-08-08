<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AppNav from '$lib/components/crm/app-nav.svelte';

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
			label: 'Accounting',
			items: [
				{ label: 'Quotes', href: '/quotes' },
				{ label: 'Invoices', href: '/invoices' },
				{ label: 'Bills', href: '/bills' },
				{ label: 'Payments', href: '/payments' }
			]
		},
		{
			label: 'Comms',
			items: [
				{ label: 'Email', href: '/email' },
				{ label: 'Templates', href: '/email/templates' },
				{ label: 'Playbooks', href: '/playbooks' },
				{ label: 'Documents', href: '/documents' }
			]
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/AppNav',
		component: AppNav,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		},
		args: {
			orgName: 'Acme Org',
			groups
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props = /** @type {import('$lib/components/crm/app-nav.svelte').AppNavProps} */ (args)}
		<div class="bg-background h-[720px]">
			<AppNav {...props} />
		</div>
	{/snippet}
</Story>
