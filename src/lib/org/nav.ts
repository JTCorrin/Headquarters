import type { AppNavGroup } from '$lib/components/crm/app-nav.svelte';

export function appNavGroups(activeLabel?: string): AppNavGroup[] {
	const mark = (label: string) => (activeLabel ? label === activeLabel : false);
	return [
		{
			items: [
				{ label: 'Dashboard', href: '/', active: mark('Dashboard') },
				{ label: 'Contacts', href: '/contacts', active: mark('Contacts') },
				{ label: 'Leads', href: '/leads', active: mark('Leads') },
				{ label: 'Clients', href: '/clients', active: mark('Clients') },
				{ label: 'Products', href: '/products', active: mark('Products') }
			]
		},
		{
			label: 'Work',
			items: [
				{ label: 'Tasks', href: '/tasks', active: mark('Tasks') },
				{ label: 'Meetings', href: '/meetings', active: mark('Meetings') },
				{ label: 'Projects', href: '/projects', active: mark('Projects') }
			]
		},
		{
			label: 'Accounting',
			items: [
				{ label: 'Quotes', href: '/quotes', active: mark('Quotes') },
				{ label: 'Invoices', href: '/invoices', active: mark('Invoices') },
				{ label: 'Bills', href: '/bills', active: mark('Bills') },
				{ label: 'Payments', href: '/payments', active: mark('Payments') }
			]
		},
		{
			label: 'Comms',
			items: [
				{ label: 'Email', href: '/email', active: mark('Email') },
				{ label: 'Templates', href: '/email/templates', active: mark('Templates') },
				{ label: 'Documents', href: '/documents', active: mark('Documents') }
			]
		},
		{
			label: 'Organisation',
			items: [
				{ label: 'Config', href: '/org/config', active: mark('Config') },
				{ label: 'Switch organisation', href: '/select-org', active: mark('Switch organisation') }
			]
		}
	];
}
