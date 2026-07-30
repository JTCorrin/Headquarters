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
		body: 'To ava@northwind.com · Template: Client kickoff\n\nHi Ava — sharing the kickoff pack and next steps for the retainer.',
		occurredAt: 'Yesterday',
		actor: 'Joe',
		isLast: true
	}}
/>

<Story
	name="Hover expand"
	args={{
		kind: 'email',
		title: 'Hover me to read the body',
		body: 'Collapsed by default — hover or focus the card to expand the email body smoothly.',
		occurredAt: 'Today · 10:04',
		actor: 'Joe',
		isLast: true
	}}
/>

<Story name="All kinds">
	{#snippet template()}
		<div class="bg-background max-w-lg space-y-0 p-4">
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
		</div>
	{/snippet}
</Story>
