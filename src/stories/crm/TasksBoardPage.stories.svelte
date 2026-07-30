<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import TasksBoardPage from '$lib/components/crm/tasks-board-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const tasks = [
		{
			id: '1',
			title: 'Send kickoff pack',
			relatedTo: 'Northwind',
			owner: 'Joe',
			status: 'open',
			dueOn: '2026-03-18'
		},
		{
			id: '2',
			title: 'Chase overdue invoice',
			relatedTo: 'Fabrikam',
			owner: 'Maya',
			status: 'blocked',
			dueOn: '2026-03-10'
		},
		{
			id: '3',
			title: 'Prep Q2 proposal',
			relatedTo: 'Contoso',
			owner: 'Joe',
			status: 'in_progress',
			dueOn: '2026-03-22'
		},
		{
			id: '4',
			title: 'Book renewal call',
			relatedTo: 'Litware',
			owner: 'Maya',
			status: 'open',
			dueOn: '2026-03-25'
		},
		{
			id: '5',
			title: 'Confirm delivery date',
			relatedTo: 'Adventure Works',
			owner: 'Joe',
			status: 'done',
			dueOn: '2026-03-12'
		},
		{
			id: '6',
			title: 'Upload signed SOW',
			relatedTo: 'Northwind',
			owner: 'Maya',
			status: 'in_progress',
			dueOn: '2026-03-19'
		}
	];

	const { Story } = defineMeta({
		title: 'CRM/Pages/TasksBoard',
		component: TasksBoardPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Tasks'),
			tasks
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/tasks-board-page.svelte').TasksBoardPageProps} */ (
				args
			)}
		<div class="h-screen">
			<TasksBoardPage {...props} />
		</div>
	{/snippet}
</Story>
