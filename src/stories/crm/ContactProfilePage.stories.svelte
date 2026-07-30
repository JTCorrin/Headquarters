<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContactProfilePage from '$lib/components/crm/contact-profile-page.svelte';
	import {
		navGroupsWithActive,
		sampleEmailMessages,
		sampleTimelineEvents
	} from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'CRM/Pages/ContactProfile',
		component: ContactProfilePage,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		},
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Contacts'),
			breadcrumb: 'Contacts / Ava Chen',
			title: 'Ava Chen',
			status: 'Client',
			subtitle: 'Primary at Northwind · Owner Joe · Tags: retainer, EU',
			contactFields: [
				{ label: 'Email', value: 'ava@northwind.com' },
				{ label: 'Phone', value: '+44 7700 900123' },
				{ label: 'Title', value: 'Head of Operations' },
				{ label: 'Owner', value: 'Joe' }
			],
			companyFields: [
				{ label: 'Company', value: 'Northwind' },
				{ label: 'Website', value: 'northwind.com' },
				{ label: 'Industry', value: 'Wholesale / logistics' },
				{ label: 'Billing address', value: '12 Harbour Rd, London' }
			],
			timelineEvents: sampleTimelineEvents,
			emailMessages: sampleEmailMessages,
			moneyItems: [
				{
					id: 'm1',
					kind: 'quote',
					label: 'Q-0142 · Q2 retainer',
					amount: '£4,200.00',
					status: 'Sent',
					date: 'Mar 12'
				},
				{
					id: 'm2',
					kind: 'invoice',
					label: 'INV-0881',
					amount: '£4,200.00',
					status: 'Partial',
					date: 'Mar 1'
				},
				{
					id: 'm3',
					kind: 'payment',
					label: 'Stripe · INV-0881',
					amount: '£2,000.00',
					status: 'Matched',
					date: 'Mar 18'
				}
			]
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
