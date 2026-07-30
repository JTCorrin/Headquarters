<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import TimelineEventCard from '$lib/components/crm/timeline-event-card.svelte';
	import { TIMELINE_EVENT_KINDS } from '$lib/components/crm/timeline-kinds.js';

	const { Story } = defineMeta({
		title: 'CRM/TimelineEventCard',
		component: TimelineEventCard,
		tags: ['autodocs']
	});
</script>

<Story
	name="Payment"
	args={{
		kind: 'payment',
		title: 'Invoice #881 paid · £4,200',
		body: 'Matched via Stripe · transactional email sent to billing contact',
		occurredAt: 'Today · 09:12',
		actor: 'System',
		isLast: true
	}}
/>

<Story
	name="Email"
	args={{
		kind: 'email',
		title: 'Q2 retainer kickoff',
		body: 'To ava@northwind.com · Template: Client kickoff',
		occurredAt: 'Yesterday',
		actor: 'Joe',
		isLast: true
	}}
/>

<div class="max-w-lg space-y-0">
	<Story name="All kinds">
		{#each TIMELINE_EVENT_KINDS as kind, index (kind)}
			<TimelineEventCard
				{kind}
				title={`${kind} event`}
				body="Sample body for this timeline kind."
				occurredAt="Mar 12"
				actor="Joe"
				isLast={index === TIMELINE_EVENT_KINDS.length - 1}
			/>
		{/each}
	</Story>
</div>
