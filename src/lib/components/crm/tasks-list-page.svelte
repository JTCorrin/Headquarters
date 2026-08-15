<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { TaskAssigneeOption, TaskFormData } from '$lib/schemas/task.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import TasksBoard from './tasks-board.svelte';
	import type { TaskBoardCard, TaskBoardMove } from './tasks-board.svelte';
	import TaskFormDrawer from './task-form-drawer.svelte';
	import MyTasksPanel, { type DashboardTask } from './my-tasks-panel.svelte';
	import ListFilterBanner from './list-filter-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export type TasksViewMode = 'list' | 'board';

	export interface TasksListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		/** Dense My-tasks-panel list (preferred list view). */
		listTasks?: DashboardTask[];
		boardTasks?: TaskBoardCard[];
		viewMode?: TasksViewMode;
		form?: SuperForm<TaskFormData>;
		editForm?: SuperForm<TaskFormData>;
		assigneeOptions?: TaskAssigneeOption[];
		drawerOpen?: boolean;
		editDrawerOpen?: boolean;
		filterLabel?: string | null;
		onClearFilter?: () => void;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onValidEdit?: () => boolean | void | Promise<boolean | void>;
		onEditTask?: (id: string) => void;
		onDeleteTask?: () => void | Promise<void>;
		onToggleDone?: (id: string) => void;
		onMoveTask?: (move: TaskBoardMove) => void | Promise<void>;
		onViewModeChange?: (mode: TasksViewMode) => void;
	}

	let {
		orgName,
		navGroups,
		listTasks = [],
		boardTasks = [],
		viewMode = 'list',
		form,
		editForm,
		assigneeOptions = [],
		drawerOpen = $bindable(false),
		editDrawerOpen = $bindable(false),
		filterLabel = null,
		onClearFilter,
		showNav = true,
		class: className,
		onValidSubmit,
		onValidEdit,
		onEditTask,
		onDeleteTask,
		onToggleDone,
		onMoveTask,
		onViewModeChange
	}: TasksListPageProps = $props();
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>

	<main class="flex min-w-0 flex-1 flex-col">
		<div
			class={cn(
				'space-y-6 px-4 py-6 sm:px-6 md:px-8',
				viewMode === 'board' && 'flex min-h-0 flex-1 flex-col gap-6'
			)}
		>
			<div class={cn(viewMode === 'board' && 'shrink-0')}>
				<PageHeader title={viewMode === 'board' ? 'Tasks board' : 'Tasks'}>
					{#snippet actions()}
						{#if viewMode === 'board'}
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={() => onViewModeChange?.('list')}
							>
								List view
							</Button>
						{:else}
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={() => onViewModeChange?.('board')}
							>
								Board view
							</Button>
						{/if}
						{#if form}
							<TaskFormDrawer
								bind:open={drawerOpen}
								{form}
								{assigneeOptions}
								{onValidSubmit}
							/>
						{:else}
							<Button type="button" size="sm">New task</Button>
						{/if}
					{/snippet}
				</PageHeader>
			</div>

			{#if filterLabel}
				<ListFilterBanner label={filterLabel} onClear={onClearFilter} />
			{/if}

			{#if viewMode === 'board'}
				<TasksBoard
					tasks={boardTasks}
					class="min-h-0 flex-1"
					onSelectTask={onEditTask}
					{onMoveTask}
				/>
			{:else}
				<MyTasksPanel
					title="All tasks"
					tasks={listTasks}
					emptyMessage="No tasks yet — create your first task."
					onToggleDone={onToggleDone}
					onSelectTask={onEditTask}
					showViewAll={false}
					class="w-full"
				/>
			{/if}
		</div>
	</main>
</AppSidebarFrame>

{#if editForm}
	<TaskFormDrawer
		bind:open={editDrawerOpen}
		form={editForm}
		{assigneeOptions}
		showTrigger={false}
		title="Edit task"
		description="Update task details. Changes use If-Match versioning."
		submitLabel="Save changes"
		onValidSubmit={onValidEdit}
		onDelete={onDeleteTask}
	/>
{/if}
