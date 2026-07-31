<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProjectWorkspacePage from '$lib/components/crm/project-workspace-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const cards = [
		{
			id: '1',
			title: 'Draft kickoff agenda',
			assignee: 'Joe',
			column: 'done',
			dueOn: 'Done Mon'
		},
		{
			id: '2',
			title: 'Confirm billing contacts',
			assignee: 'Maya',
			column: 'review',
			dueOn: 'Due Fri'
		},
		{
			id: '3',
			title: 'Ship access credentials',
			assignee: 'Joe',
			column: 'doing',
			dueOn: 'Due Wed'
		},
		{
			id: '4',
			title: 'Map warehouse SKUs',
			assignee: 'Maya',
			column: 'doing',
			dueOn: 'Due Thu'
		},
		{
			id: '5',
			title: 'Schedule go-live call',
			assignee: 'Joe',
			column: 'backlog'
		},
		{
			id: '6',
			title: 'Write runbook',
			assignee: 'Maya',
			column: 'backlog',
			dueOn: 'Next week'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/ProjectWorkspace',
		component: ProjectWorkspacePage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Projects'),
			projectName: 'Q2 retainer delivery',
			clientName: 'Northwind',
			status: 'Active',
			owner: 'Joe',
			description: 'Delivery board for the Northwind retainer — cards stay on this project.',
			cards
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/project-workspace-page.svelte').ProjectWorkspacePageProps} */ (
				args
			)}
		<div class="h-screen">
			<ProjectWorkspacePage {...props} />
		</div>
	{/snippet}
</Story>
