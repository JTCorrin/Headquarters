<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import TasksListPage from '$lib/components/crm/tasks-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const rows = [
		{
			id: '1',
			title: 'Send kickoff pack',
			relatedTo: 'Northwind',
			owner: 'Joe',
			status: 'Open',
			priority: 'P3 — Normal',
			dueOn: '2026-03-18'
		},
		{
			id: '2',
			title: 'Chase overdue invoice',
			relatedTo: 'Fabrikam',
			owner: 'Maya',
			status: 'Overdue',
			priority: 'P1 — Urgent',
			dueOn: '2026-03-10'
		},
		{
			id: '3',
			title: 'Prep Q2 proposal',
			relatedTo: 'Contoso',
			owner: 'Joe',
			status: 'In progress',
			priority: 'P2 — High',
			dueOn: '2026-03-22'
		},
		{
			id: '4',
			title: 'Book renewal call',
			relatedTo: 'Litware',
			owner: 'Maya',
			status: 'Open',
			priority: 'P3 — Normal',
			dueOn: '2026-03-25'
		},
		{
			id: '5',
			title: 'Confirm delivery date',
			relatedTo: 'Adventure Works',
			owner: 'Joe',
			status: 'Done',
			priority: 'P4 — Low',
			dueOn: '2026-03-12'
		},
		{
			id: '6',
			title: 'Upload signed SOW',
			relatedTo: 'Northwind',
			owner: 'Maya',
			status: 'Open',
			priority: 'P3 — Normal',
			dueOn: '2026-03-19'
		},
		{
			id: '7',
			title: 'Review meeting notes',
			relatedTo: 'Contoso',
			owner: 'Joe',
			status: 'In progress',
			priority: 'P3 — Normal',
			dueOn: '2026-03-17'
		},
		{
			id: '8',
			title: 'Update product SKUs',
			relatedTo: 'Catalog',
			owner: 'Maya',
			status: 'Open',
			priority: 'P4 — Low',
			dueOn: '2026-03-28'
		},
		{
			id: '9',
			title: 'Close lost lead reason',
			relatedTo: 'Old Town',
			owner: 'Joe',
			status: 'Done',
			priority: 'P3 — Normal',
			dueOn: '2026-03-08'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/TasksList',
		component: TasksListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Tasks'),
			rows
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/tasks-list-page.svelte').TasksListPageProps} */ (
				args
			)}
		<div class="h-screen">
			<TasksListPage {...props} />
		</div>
	{/snippet}
</Story>
