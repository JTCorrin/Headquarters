<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Timeline from '$lib/components/crm/timeline.svelte';

	const { Story } = defineMeta({
		title: 'CRM/Timeline',
		component: Timeline,
		tags: ['autodocs']
	});

	const sampleEvents = [
		{
			id: '1',
			kind: 'payment',
			title: 'Invoice #881 paid · £4,200',
			body: 'Matched via Stripe · email sent to billing contact',
			occurredAt: 'Today · 09:12',
			actor: 'System'
		},
		{
			id: '2',
			kind: 'meeting',
			title: 'Q2 planning call',
			body: 'Notes synced from Meeting assistant · 3 tasks proposed',
			occurredAt: 'Yesterday · 15:40',
			actor: 'Joe'
		},
		{
			id: '3',
			kind: 'email',
			title: 'Retainer kickoff sent',
			body: 'To ava@northwind.com · Template: Client kickoff',
			occurredAt: 'Mon · 11:02',
			actor: 'Joe'
		},
		{
			id: '4',
			kind: 'status',
			title: 'Lead → Client',
			body: 'Converted after signed proposal',
			occurredAt: 'Mar 2',
			actor: 'Joe'
		},
		{
			id: '5',
			kind: 'document',
			title: 'MSA uploaded',
			body: 'northwind-msa-2026.pdf',
			occurredAt: 'Feb 28',
			actor: 'Ava'
		},
		{
			id: '6',
			kind: 'task',
			title: 'Send onboarding checklist',
			body: 'Due Fri · assigned to Joe',
			occurredAt: 'Feb 27',
			actor: 'Joe'
		},
		{
			id: '7',
			kind: 'call',
			title: 'Discovery call logged',
			body: '20m · pain points: invoicing lag, multi-contact ownership',
			occurredAt: 'Feb 20',
			actor: 'Joe'
		},
		{
			id: '8',
			kind: 'note',
			title: 'Intro via referral',
			body: 'Referred by Sam at Contoso',
			occurredAt: 'Feb 18',
			actor: 'Joe'
		}
	];
</script>

<div class="bg-background max-w-xl p-4">
	<Story name="Default" args={{ events: sampleEvents, title: 'Activity' }} />
</div>

<div class="bg-background max-w-xl p-4">
	<Story name="Empty" args={{ events: [], title: 'Activity', emptyMessage: 'No activity on this contact yet.' }} />
</div>
