<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContactProfilePage from '$lib/components/crm/contact-profile-page.svelte';

	const navGroups = [
		{
			items: [
				{ label: 'Dashboard', href: '/' },
				{ label: 'Contacts', href: '/contacts', active: true },
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

	const contactFields = [
		{ label: 'Email', value: 'ava@northwind.com' },
		{ label: 'Phone', value: '+44 7700 900123' },
		{ label: 'Title', value: 'Head of Operations' },
		{ label: 'Owner', value: 'Joe' }
	];

	const companyFields = [
		{ label: 'Company', value: 'Northwind' },
		{ label: 'Website', value: 'northwind.com' },
		{ label: 'Industry', value: 'Wholesale / logistics' },
		{ label: 'Billing address', value: '12 Harbour Rd, London' }
	];

	const timelineEvents = [
		{
			id: '1',
			kind: 'payment',
			title: 'Invoice #881 paid · £4,200',
			body: 'Matched via Stripe',
			occurredAt: 'Today · 09:12',
			actor: 'System'
		},
		{
			id: '2',
			kind: 'meeting',
			title: 'Q2 planning call',
			body: '3 tasks proposed from transcript',
			occurredAt: 'Yesterday · 15:40',
			actor: 'Joe'
		},
		{
			id: '3',
			kind: 'email',
			title: 'Retainer kickoff sent',
			body: 'Template: Client kickoff',
			occurredAt: 'Mon · 11:02',
			actor: 'Joe'
		},
		{
			id: '4',
			kind: 'status',
			title: 'Lead → Client',
			occurredAt: 'Mar 2',
			actor: 'Joe'
		},
		{
			id: '5',
			kind: 'note',
			title: 'Intro via referral',
			body: 'Referred by Sam at Contoso',
			occurredAt: 'Feb 18',
			actor: 'Joe'
		}
	];

	const { Story } = defineMeta({
		title: 'CRM/Pages/ContactProfile',
		component: ContactProfilePage,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		},
		args: {
			orgName: 'Acme Org',
			navGroups,
			breadcrumb: 'Contacts / Ava Chen',
			title: 'Ava Chen',
			status: 'Client',
			subtitle: 'Primary at Northwind · Owner Joe · Tags: retainer, EU',
			contactFields,
			companyFields,
			timelineEvents
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/contact-profile-page.svelte').ContactProfilePageProps} */ (
				args
			)}
		<div class="h-screen">
			<ContactProfilePage {...props} />
		</div>
	{/snippet}
</Story>
