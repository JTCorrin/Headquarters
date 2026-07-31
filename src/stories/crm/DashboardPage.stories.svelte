<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DashboardPage from '$lib/components/crm/dashboard-page.svelte';
	import { navGroupsWithActive, sampleTimelineEvents } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/Dashboard',
		component: DashboardPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Dashboard'),
			stats: [
				{ label: 'Open leads', value: '24', hint: 'Across all owners' },
				{ label: 'Pipeline value', value: '£186k', hint: 'Qualified + proposal' },
				{ label: 'Invoices unpaid', value: '£18.4k', hint: '3 overdue' },
				{ label: 'Tasks due', value: '7', hint: 'This week' }
			],
			recentActivity: sampleTimelineEvents
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/dashboard-page.svelte').DashboardPageProps} */ (
				args
			)}
		<div class="h-screen">
			<DashboardPage {...props} />
		</div>
	{/snippet}
</Story>
