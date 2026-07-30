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
			emailMessages: sampleEmailMessages
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
