<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ClientProfilePage from '$lib/components/crm/client-profile-page.svelte';
	import {
		navGroupsWithActive,
		sampleEmailMessages,
		sampleTimelineEvents
	} from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'CRM/Pages/ClientProfile',
		component: ClientProfilePage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Clients'),
			breadcrumb: 'Clients / Northwind',
			title: 'Northwind',
			status: 'Client',
			subtitle: 'Owner Joe · Tags: retainer, EU',
			companyFields: [
				{ label: 'Website', value: 'northwind.com' },
				{ label: 'Industry', value: 'Wholesale / logistics' },
				{ label: 'Timezone', value: 'Europe/London' }
			],
			billingFields: [
				{ label: 'Billing address', value: '12 Harbour Rd, London' },
				{ label: 'Currency', value: 'GBP' },
				{ label: 'Payment terms', value: 'Net 30' }
			],
			relatedContacts: [
				{
					id: '1',
					name: 'Ava Chen',
					role: 'Primary',
					email: 'ava@northwind.com'
				},
				{
					id: '2',
					name: 'Northwind Billing',
					role: 'Billing',
					email: 'billing@northwind.com'
				}
			],
			timelineEvents: sampleTimelineEvents,
			emailMessages: sampleEmailMessages
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/client-profile-page.svelte').ClientProfilePageProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientProfilePage {...props} />
		</div>
	{/snippet}
</Story>
