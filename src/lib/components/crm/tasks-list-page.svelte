<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import TasksTable from './tasks-table.svelte';
	import type { TaskRow } from './tasks-columns.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface TasksListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: TaskRow[];
		class?: string;
	}

	let { orgName, navGroups, rows, class: className }: TasksListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Work"
				title="Tasks"
				description="Follow-ups from meetings, emails, and pipeline stages."
			>
				{#snippet actions()}
					<Button type="button" size="sm">New task</Button>
				{/snippet}
			</PageHeader>

			<TasksTable {rows} />
		</div>
	</main>
</div>
