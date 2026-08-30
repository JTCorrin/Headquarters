<script lang="ts">
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import TasksBoard, { type TaskBoardCard } from './tasks-board.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface TasksBoardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		tasks: TaskBoardCard[];
		class?: string;
	}

	let { orgName, navGroups, tasks, class: className }: TasksBoardPageProps = $props();
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	showNav
	showTrigger
	class={cn('h-full min-h-[720px]', className)}
>
	<main class="flex min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex min-h-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 md:px-8">
			<div class="shrink-0">
				<PageHeader title="Tasks board">
					{#snippet actions()}
						<Button variant="outline" size="sm">Table view</Button>
						<Button size="sm">New task</Button>
					{/snippet}
				</PageHeader>
			</div>
			<TasksBoard {tasks} class="min-h-0 flex-1" />
		</div>
	</main>
</AppSidebarFrame>
