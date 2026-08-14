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
					{ label: 'Outstanding AR', value: '£18,400.00', hint: '12 open · 3 overdue' },
					{ label: 'Overdue AR', value: '£4,960.00', hint: '3 need chasing' },
					{ label: 'Cash collected (30d)', value: '£12,250.00', hint: 'vs prior 30d · +18%' },
					{ label: 'Booked (30d)', value: '£21,800.00', hint: 'vs prior 30d · +6%' }
				]}
				agingBars={[
					{ label: 'Current', cents: 820000, count: 6, display: '£8,200.00' },
					{ label: '1–30 days', cents: 296000, count: 2, display: '£2,960.00' },
					{ label: '31–60 days', cents: 480000, count: 2, display: '£4,800.00' },
					{ label: '61–90 days', cents: 144000, count: 1, display: '£1,440.00' },
					{ label: '90+ days', cents: 100000, count: 1, display: '£1,000.00' }
				]}
				trendPoints={[
					{ label: 'Mar', cashCents: 820000, bookedCents: 1100000 },
					{ label: 'Apr', cashCents: 940000, bookedCents: 980000 },
					{ label: 'May', cashCents: 1010000, bookedCents: 1250000 },
					{ label: 'Jun', cashCents: 880000, bookedCents: 1320000 },
					{ label: 'Jul', cashCents: 1140000, bookedCents: 1410000 },
					{ label: 'Aug', cashCents: 1225000, bookedCents: 2180000 }
				]}
				pipelineBars={[
					{ label: 'Draft', count: 4, display: '£12,400.00' },
					{ label: 'Sent', count: 7, display: '£48,200.00' },
					{ label: 'Accepted', count: 3, display: '£22,100.00' },
					{ label: 'Rejected', count: 1, display: '£3,600.00' }
				]}
				{myTasks}
				attentionItems={[
					{
						id: 'a1',
						label: 'INV-0883 overdue',
						detail: 'Fabrikam · £960.00 · 21d',
						href: '/invoices/inv-1',
						tone: 'warn',
						badge: 'Overdue'
					},
					{
						id: 'a2',
						label: 'Q-0142 awaiting reply',
						detail: 'Northwind · £4,800.00 · sent 5d ago',
						href: '/quotes/q-1',
						badge: 'Awaiting'
					},
					{
						id: 'a3',
						label: 'INV-0910 due soon',
						detail: 'Contoso · £1,240.00 · 3d',
						href: '/invoices/inv-2',
						badge: 'Due soon'
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
