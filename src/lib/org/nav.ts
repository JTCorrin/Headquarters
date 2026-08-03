import type { AppNavGroup } from '$lib/components/crm/app-nav.svelte';
import type { MembershipRole } from '$lib/schemas/organisation.js';
import {
	canAccessAuditLog,
	canAccessOrgConfigRoutes,
	canAccessPersonalConfig
} from '$lib/schemas/organisation.js';

export function appNavGroups(
	activeLabel?: string,
	role: MembershipRole = 'owner'
): AppNavGroup[] {
	const mark = (label: string) => (activeLabel ? label === activeLabel : false);
	const organisationItems: AppNavGroup['items'] = [];

	if (canAccessOrgConfigRoutes(role)) {
		organisationItems.push(
			{ label: 'Config', href: '/org/config', active: mark('Config') },
			{ label: 'Integrations', href: '/org/integrations', active: mark('Integrations') }
		);
	}
	if (canAccessAuditLog(role)) {
		organisationItems.push({
			label: 'Audit log',
			href: '/org/audit-log',
			active: mark('Audit log')
		});
	}
	if (canAccessPersonalConfig(role)) {
		organisationItems.push({
			label: 'My settings',
			href: '/settings',
			active: mark('My settings')
		});
	}
	organisationItems.push({
		label: 'Switch organisation',
		href: '/select-org',
		active: mark('Switch organisation')
	});

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
				{
					label: 'Recurring',
					href: '/recurring-invoices',
					active: mark('Recurring')
				},
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
			items: organisationItems
		}
	];
}
