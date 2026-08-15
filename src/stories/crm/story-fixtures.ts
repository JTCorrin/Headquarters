import type { AppNavGroup } from '$lib/components/crm/app-nav.svelte';
import type { EmailMessage } from '$lib/components/crm/entity-email-inbox.svelte';
import type {
	DocumentEntry,
	EntityDocument
} from '$lib/components/crm/entity-documents.svelte';
import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';

export const storyViewport = {
	mobile: { viewport: { value: 'mobile', isRotated: false } },
	tablet: { viewport: { value: 'tablet', isRotated: false } },
	desktop: { viewport: { value: 'desktop', isRotated: false } }
};

export function navGroupsWithActive(
	activeLabel: string,
	role: 'owner' | 'admin' | 'member' | 'billing' | 'readonly' = 'owner'
): AppNavGroup[] {
	const mark = (label: string) => label === activeLabel;
	const organisationItems = [
		...(role === 'owner'
			? [
					{ label: 'Config', href: '/org/config', active: mark('Config') },
					{ label: 'Integrations', href: '/org/integrations', active: mark('Integrations') }
				]
			: []),
		...(role === 'owner' || role === 'admin'
			? [
					{ label: 'API keys', href: '/org/api-keys', active: mark('API keys') },
					{ label: 'Audit log', href: '/org/audit-log', active: mark('Audit log') }
				]
			: []),
		...(role !== 'billing'
			? [{ label: 'My settings', href: '/settings', active: mark('My settings') }]
			: []),
		{ label: 'Switch organisation', href: '/select-org', active: mark('Switch organisation') }
	];
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

export const sampleContractDocuments: DocumentEntry[] = [
	{
		id: 'folder-signed',
		kind: 'folder',
		name: 'Signed',
		itemCount: 1,
		updatedAt: 'Feb 20'
	},
	{
		id: 'c1',
		kind: 'file',
		name: 'MSA — Northwind.pdf',
		category: 'contract',
		sizeLabel: '240 KB',
		uploadedAt: 'Jan 12',
		uploadedBy: 'Joe'
	},
	{
		id: 'c2',
		kind: 'file',
		name: 'DPA addendum.pdf',
		category: 'contract',
		sizeLabel: '120 KB',
		uploadedAt: 'Feb 2',
		uploadedBy: 'Maya'
	}
];

export const sampleBillDocuments: DocumentEntry[] = [
	{
		id: 'folder-2026',
		kind: 'folder',
		name: '2026',
		itemCount: 2,
		updatedAt: 'Apr 1'
	},
	{
		id: 'b1',
		kind: 'file',
		name: 'Vendor — Acme hosting.pdf',
		category: 'invoice',
		sizeLabel: '96 KB',
		uploadedAt: 'Mar 28',
		uploadedBy: 'Joe'
	},
	{
		id: 'b2',
		kind: 'file',
		name: 'Office supplies receipt.pdf',
		category: 'receipt',
		sizeLabel: '40 KB',
		uploadedAt: 'Apr 3',
		uploadedBy: 'Maya'
	}
];

export const sampleClientWorkspaceDocuments: DocumentEntry[] = [
	{
		id: 'folder-contracts',
		kind: 'folder',
		name: 'Contracts',
		itemCount: 2,
		updatedAt: 'Mar 1'
	},
	{
		id: 'folder-bills',
		kind: 'folder',
		name: 'Bills',
		itemCount: 1,
		updatedAt: 'Apr 4'
	},
	{
		id: 'folder-meetings',
		kind: 'folder',
		name: 'Meeting artifacts',
		itemCount: 0,
		updatedAt: '—'
	},
	{
		id: 'cw1',
		kind: 'file',
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
		from: 'Ava Chen',
		fromAddress: 'ava@northwind.com',
		fromName: 'Ava Chen',
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
		fromAddress: 'joe@acme.org',
		fromName: null,
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
		fromAddress: 'billing@northwind.com',
		fromName: null,
		to: 'joe@acme.org',
		subject: 'Invoice #881 payment confirmation',
		preview: 'Payment of £4,200 received. Receipt attached.',
		body: 'Hello,\n\nPayment of £4,200 received for Invoice #881. Receipt attached.\n\nNorthwind Billing',
		occurredAt: 'Mon'
	}
];
