import type { AppNavGroup } from '$lib/components/crm/app-nav.svelte';
import type { EmailMessage } from '$lib/components/crm/entity-email-inbox.svelte';
import type { EntityDocument } from '$lib/components/crm/entity-documents.svelte';
import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';

export function navGroupsWithActive(activeLabel: string): AppNavGroup[] {
	const mark = (label: string) => label === activeLabel;
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
		}
	];
}

export const sampleTimelineEvents: TimelineEvent[] = [
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

export const sampleDocuments: EntityDocument[] = [
	{
		id: 'd1',
		name: 'MSA — Northwind.pdf',
		category: 'contract',
		sizeLabel: '240 KB',
		uploadedAt: 'Jan 12',
		uploadedBy: 'Joe'
	},
	{
		id: 'd2',
		name: 'Q2 retainer proposal.pdf',
		category: 'proposal',
		sizeLabel: '1.1 MB',
		uploadedAt: 'Mar 8',
		uploadedBy: 'Maya'
	},
	{
		id: 'd3',
		name: 'Kickoff deck.pdf',
		category: 'other',
		sizeLabel: '3.4 MB',
		uploadedAt: 'Mar 14',
		uploadedBy: 'Joe'
	}
];

export const sampleEmailMessages: EmailMessage[] = [
	{
		id: 'e1',
		direction: 'in',
		from: 'ava@northwind.com',
		to: 'joe@acme.org',
		subject: 'Re: Q2 retainer kickoff',
		preview: 'Thanks — can we move the kickoff to Thursday morning?',
		body: 'Hi Joe,\n\nThanks for sending the pack. Can we move the kickoff to Thursday morning?\n\nBest,\nAva',
		occurredAt: 'Today · 08:41',
		unread: true
	},
	{
		id: 'e2',
		direction: 'out',
		from: 'joe@acme.org',
		to: 'ava@northwind.com',
		subject: 'Q2 retainer kickoff',
		preview: 'Sharing the kickoff pack and next steps for the retainer.',
		body: 'Hi Ava,\n\nSharing the kickoff pack and next steps for the retainer.\n\n— Joe',
		occurredAt: 'Yesterday'
	},
	{
		id: 'e3',
		direction: 'in',
		from: 'billing@northwind.com',
		to: 'joe@acme.org',
		subject: 'Invoice #881 payment confirmation',
		preview: 'Payment of £4,200 received. Receipt attached.',
		body: 'Hello,\n\nPayment of £4,200 received for Invoice #881. Receipt attached.\n\nNorthwind Billing',
		occurredAt: 'Mon'
	}
];
