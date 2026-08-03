<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import StatCard from './stat-card.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import MyTasksPanel, { type DashboardTask } from './my-tasks-panel.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';

	export interface DashboardStat {
		label: string;
		value: string;
		hint?: string;
	}

	export interface DashboardAttentionItem {
		id: string;
		label: string;
		detail: string;
		tone?: 'default' | 'warn';
	}

	export interface DashboardMeeting {
		id: string;
		title: string;
		when: string;
		withWhom: string;
	}

	export interface DashboardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		stats: DashboardStat[];
		myTasks?: DashboardTask[];
		attentionItems?: DashboardAttentionItem[];
		upcomingMeetings?: DashboardMeeting[];
		recentActivity: TimelineEvent[];
		onToggleTask?: (id: string) => void;
		onSelectTask?: (id: string) => void;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		stats,
		myTasks = [],
		attentionItems = [],
		upcomingMeetings = [],
		recentActivity,
		onToggleTask,
		onSelectTask,
		showNav = true,
		class: className
	}: DashboardPageProps = $props();
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="shrink-0" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Headquarters"
				title="Home"
				description="Your pulse for the day — tasks, money that needs a nudge, and what’s coming up."
			>
				{#snippet actions()}
					<Button size="sm" href="/tasks">New task</Button>
				{/snippet}
			</PageHeader>

			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{#each stats as stat (stat.label)}
					<StatCard label={stat.label} value={stat.value} hint={stat.hint} />
				{/each}
			</div>

			<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]">
				<MyTasksPanel
					tasks={myTasks}
					onToggleDone={onToggleTask}
					{onSelectTask}
					class="self-start"
				/>

				<div class="space-y-6">
					<section
						class="bg-card self-start rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="mb-4 flex items-center gap-2">
							<AlertTriangleIcon class="text-muted-foreground size-4" />
							<h2 class="text-sm font-semibold tracking-tight">Needs attention</h2>
						</div>
						{#if attentionItems.length === 0}
							<p class="text-muted-foreground text-sm">All clear for now.</p>
						{:else}
							<ul class="m-0 list-none space-y-3 p-0">
								{#each attentionItems as item (item.id)}
									<li class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<p class="text-sm font-medium">{item.label}</p>
											<p class="text-muted-foreground truncate text-xs">{item.detail}</p>
										</div>
										{#if item.tone === 'warn'}
											<StatusBadge status="Overdue" />
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</section>

					<section
						class="bg-card self-start rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="mb-4 flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<CalendarIcon class="text-muted-foreground size-4" />
								<h2 class="text-sm font-semibold tracking-tight">Upcoming meetings</h2>
							</div>
							<Button type="button" variant="ghost" size="sm" href="/meetings">All</Button>
						</div>
						{#if upcomingMeetings.length === 0}
							<p class="text-muted-foreground text-sm">No meetings on the horizon.</p>
						{:else}
							<ul class="m-0 list-none space-y-3 p-0">
								{#each upcomingMeetings as meeting (meeting.id)}
									<li>
										<a href="/meetings/{meeting.id}" class="text-sm font-medium hover:underline">
											{meeting.title}
										</a>
										<p class="text-muted-foreground text-xs">
											{meeting.when} · {meeting.withWhom}
										</p>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				</div>
			</div>

			<Timeline
				events={recentActivity}
				title="Recent activity"
				emptyMessage="No org-wide activity feed yet — open a record to see its timeline."
				class="bg-card rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10"
			/>
		</div>
	</main>
</div>
