<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LeadsBoardPage from '$lib/components/crm/leads-board-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const leads = [
		{
			id: '1',
			name: 'Contoso expansion',
			company: 'Contoso',
			value: '£18k',
			owner: 'Joe',
			stage: 'new'
		},
		{
			id: '2',
			name: 'Fabrikam pilot',
			company: 'Fabrikam',
			value: '£6.5k',
			owner: 'Maya',
			stage: 'qualified'
		},
		{
			id: '3',
			name: 'Litware retainer',
			company: 'Litware',
			value: '£4.2k',
			owner: 'Joe',
			stage: 'proposal'
		},
		{
			id: '4',
			name: 'Adventure Works kit',
			company: 'Adventure Works',
			value: '£12k',
			owner: 'Maya',
			stage: 'proposal'
		},
		{
			id: '5',
			name: 'Northwind upsell',
			company: 'Northwind',
			value: '£9k',
			owner: 'Joe',
			stage: 'won'
		},
		{
			id: '6',
			name: 'Old town cafe',
			company: 'Old Town',
			value: '£1.2k',
			owner: 'Maya',
			stage: 'lost'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/LeadsBoard',
		component: LeadsBoardPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Leads'),
			leads
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/leads-board-page.svelte').LeadsBoardPageProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadsBoardPage {...props} />
		</div>
	{/snippet}
</Story>
