<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DashboardPage from '$lib/components/crm/dashboard-page.svelte';
	import { navGroupsWithActive, sampleTimelineEvents } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/Dashboard',
		component: DashboardPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import type { DashboardTask } from '$lib/components/crm/my-tasks-panel.svelte';

	let myTasks = $state<DashboardTask[]>([
		{
			id: '1',
			title: 'Send kickoff pack',
			relatedTo: 'Northwind',
			dueOn: 'Today',
			status: 'Open',
			priority: 'p1'
		},
		{
			id: '2',
			title: 'Chase overdue invoice INV-0883',
			relatedTo: 'Fabrikam',
			dueOn: 'Mar 10',
			status: 'Overdue',
			priority: 'p1'
		},
		{
			id: '3',
			title: 'Prep Q2 proposal',
			relatedTo: 'Contoso',
			dueOn: 'Mar 22',
			status: 'In progress',
			priority: 'p2'
		},
		{
			id: '4',
			title: 'Review meeting notes',
			relatedTo: 'Contoso',
			dueOn: 'Tomorrow',
			status: 'In progress',
			priority: 'p2'
		},
		{
			id: '5',
			title: 'Upload signed SOW',
			relatedTo: 'Northwind',
			dueOn: 'Mar 19',
			status: 'Open',
			priority: 'p3'
		},
		{
			id: '6',
			title: 'Confirm delivery date',
			relatedTo: 'Adventure Works',
			dueOn: 'Mar 12',
			status: 'Done',
			priority: 'p3'
		}
	]);

	function toggleTask(id: string) {
		myTasks = myTasks.map((task) => {
			if (task.id !== id) return task;
			const done = task.status.toLowerCase() === 'done';
			return { ...task, status: done ? 'Open' : 'Done' };
		});
	}
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<DashboardPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Dashboard')}
				stats={[
					{ label: 'Open leads', value: '24', hint: 'Across all owners' },
					{ label: 'Pipeline value', value: '£186k', hint: 'Qualified + proposal' },
					{ label: 'Invoices unpaid', value: '£18.4k', hint: '3 overdue' },
					{ label: 'My open tasks', value: String(myTasks.filter((t) => t.status !== 'Done').length), hint: 'Assigned to you' }
				]}
				{myTasks}
				attentionItems={[
					{
						id: 'a1',
						label: 'INV-0883 overdue',
						detail: 'Fabrikam · £960 · 21 days',
						tone: 'warn'
					},
					{
						id: 'a2',
						label: 'Q-0142 waiting reply',
						detail: 'Northwind · sent 5 days ago'
					},
					{
						id: 'a3',
						label: 'BILL-0142 due soon',
						detail: 'AWS · £1,240 · Mar 20'
					}
				]}
				upcomingMeetings={[
					{
						id: 'm1',
						title: 'Q2 planning',
						when: 'Today · 15:00',
						withWhom: 'Ava · Northwind'
					},
					{
						id: 'm2',
						title: 'Renewal check-in',
						when: 'Thu · 11:30',
						withWhom: 'Sam · Contoso'
					},
					{
						id: 'm3',
						title: 'Kickoff dry-run',
						when: 'Fri · 09:00',
						withWhom: 'Internal'
					}
				]}
				recentActivity={sampleTimelineEvents}
				onToggleTask={toggleTask}
			/>
		</div>
	{/snippet}
</Story>
