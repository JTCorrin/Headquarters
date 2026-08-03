<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import TasksListPage from '$lib/components/crm/tasks-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const listTasks = [
		{
			id: '1',
			title: 'Send kickoff pack',
			relatedTo: 'Northwind',
			dueOn: '2026-03-18',
			status: 'Open',
			priority: 'p3'
		},
		{
			id: '2',
			title: 'Chase overdue invoice',
			relatedTo: 'Fabrikam',
			dueOn: '2026-03-10',
			status: 'Overdue',
			priority: 'p1'
		},
		{
			id: '3',
			title: 'Prep Q2 proposal',
			relatedTo: 'Contoso',
			dueOn: '2026-03-22',
			status: 'In progress',
			priority: 'p2'
		},
		{
			id: '4',
			title: 'Book renewal call',
			relatedTo: 'Litware',
			dueOn: '2026-03-25',
			status: 'Open',
			priority: 'p3'
		},
		{
			id: '5',
			title: 'Confirm delivery date',
			relatedTo: 'Adventure Works',
			dueOn: '2026-03-12',
			status: 'Done',
			priority: 'p4'
		},
		{
			id: '6',
			title: 'Upload signed SOW',
			relatedTo: 'Northwind',
			dueOn: '2026-03-19',
			status: 'Open',
			priority: 'p3'
		},
		{
			id: '7',
			title: 'Review meeting notes',
			relatedTo: 'Contoso',
			dueOn: '2026-03-17',
			status: 'In progress',
			priority: 'p3'
		},
		{
			id: '8',
			title: 'Update product SKUs',
			relatedTo: 'Catalog',
			dueOn: '2026-03-28',
			status: 'Open',
			priority: 'p4'
		},
		{
			id: '9',
			title: 'Close lost lead reason',
			relatedTo: 'Old Town',
			dueOn: '2026-03-08',
			status: 'Done',
			priority: 'p3'
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
			listTasks
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
