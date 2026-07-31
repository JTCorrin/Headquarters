<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import StatCard from './stat-card.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface DashboardStat {
		label: string;
		value: string;
		hint?: string;
	}

	export interface DashboardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		stats: DashboardStat[];
		recentActivity: TimelineEvent[];
		class?: string;
	}

	let {
		orgName,
		navGroups,
		stats,
		recentActivity,
		class: className
	}: DashboardPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Headquarters"
				title="Dashboard"
				description="A quick pulse across pipeline, money, and recent activity."
			>
				{#snippet actions()}
					<Button variant="outline" size="sm">Quick create</Button>
				{/snippet}
			</PageHeader>

			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{#each stats as stat (stat.label)}
					<StatCard label={stat.label} value={stat.value} hint={stat.hint} />
				{/each}
			</div>

			<div class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
				<section
					class="bg-card rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
				>
					<h2 class="mb-4 text-sm font-semibold tracking-tight">This week</h2>
					<ul class="text-muted-foreground m-0 list-none space-y-3 p-0 text-sm">
						<li class="flex items-center justify-between gap-3">
							<span>Meetings scheduled</span>
							<span class="text-foreground font-medium">4</span>
						</li>
						<li class="flex items-center justify-between gap-3">
							<span>Quotes waiting</span>
							<span class="text-foreground font-medium">2</span>
						</li>
						<li class="flex items-center justify-between gap-3">
							<span>Invoices overdue</span>
							<span class="text-foreground font-medium">1</span>
						</li>
						<li class="flex items-center justify-between gap-3">
							<span>Open tasks</span>
							<span class="text-foreground font-medium">7</span>
						</li>
					</ul>
				</section>

				<Timeline events={recentActivity} title="Recent activity" class="min-h-0" />
			</div>
		</div>
	</main>
</div>
