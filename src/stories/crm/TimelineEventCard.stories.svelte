<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import TimelineEventCard from '$lib/components/crm/timeline-event-card.svelte';

	const { Story } = defineMeta({
		title: 'CRM/TimelineEventCard',
		component: TimelineEventCard,
		tags: ['autodocs']
	});
</script>

<Story
	name="Payment"
	args={{
		kind: 'Payment',
		title: 'Invoice #881 paid · £4,200',
		body: 'Matched via Stripe · transactional email sent to billing contact',
		occurredAt: 'Today · 09:12'
	}}
/>

<Story
	name="Email"
	args={{
		kind: 'Email',
		title: 'Q2 retainer kickoff',
		body: 'To ava@northwind.com · Template: Client kickoff',
		occurredAt: 'Yesterday'
	}}
/>
