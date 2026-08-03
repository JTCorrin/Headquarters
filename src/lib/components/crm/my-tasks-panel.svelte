<script lang="ts">
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';

	export interface DashboardTask {
		id: string;
		title: string;
		relatedTo?: string;
		dueOn: string;
		status: string;
		priority?: 'p1' | 'p2' | 'p3' | 'p4';
	}

	export interface MyTasksPanelProps {
		tasks?: DashboardTask[];
		title?: string;
		emptyMessage?: string;
		onToggleDone?: (id: string) => void;
		/** Opens edit / detail when the task title is activated. */
		onSelectTask?: (id: string) => void;
		onViewAll?: () => void;
		/** When false, hide the View all control (e.g. already on /tasks). */
		showViewAll?: boolean;
		class?: string;
	}

	let {
		tasks = [],
		title = 'My tasks',
		emptyMessage = 'Nothing on your plate — nice.',
		onToggleDone,
		onSelectTask,
		onViewAll,
		showViewAll = true,
		class: className
	}: MyTasksPanelProps = $props();

	const openCount = $derived(tasks.filter((t) => t.status.toLowerCase() !== 'done').length);

	function priorityDot(priority?: DashboardTask['priority']): string {
		switch (priority) {
			case 'p1':
				return 'bg-rose-500';
			case 'p2':
				return 'bg-orange-500';
			case 'p3':
				return 'bg-amber-400';
			default:
				return 'bg-muted-foreground/40';
		}
	}

	function isDone(status: string): boolean {
		return status.toLowerCase() === 'done';
	}
</script>

<section
	class={cn(
		'bg-card flex min-h-0 flex-col overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="flex items-center justify-between gap-3 px-4 py-3">
		<div>
			<p class="text-sm font-semibold tracking-tight">{title}</p>
			<p class="text-muted-foreground text-xs">{openCount} open</p>
		</div>
		{#if showViewAll}
			{#if onViewAll}
				<Button type="button" variant="ghost" size="sm" onclick={onViewAll}>View all</Button>
			{:else}
				<Button type="button" variant="ghost" size="sm" href="/tasks">View all</Button>
			{/if}
		{/if}
	</div>

	{#if tasks.length === 0}
		<p class="text-muted-foreground border-t px-4 py-8 text-center text-sm">{emptyMessage}</p>
	{:else}
		<ul class="m-0 max-h-[420px] list-none overflow-y-auto border-t p-0">
			{#each tasks as task (task.id)}
				<li class="border-border/80 flex items-start gap-3 border-t px-4 py-3 first:border-t-0">
					<button
						type="button"
						class={cn(
							'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
							isDone(task.status)
								? 'border-emerald-500 bg-emerald-500 text-white'
								: 'border-muted-foreground/40 text-transparent hover:border-foreground/50'
						)}
						aria-label={isDone(task.status) ? `Reopen ${task.title}` : `Complete ${task.title}`}
						onclick={() => onToggleDone?.(task.id)}
					>
						{#if isDone(task.status)}
							<CheckIcon class="size-3" />
						{:else}
							<CircleIcon class="size-3 opacity-0" />
						{/if}
					</button>
					<div class="min-w-0 flex-1">
						<div class="flex items-start gap-2">
							<span
								class={cn('mt-1.5 size-1.5 shrink-0 rounded-full', priorityDot(task.priority))}
								aria-hidden="true"
							></span>
							{#if onSelectTask}
								<button
									type="button"
									class={cn(
										'text-left text-sm font-medium leading-snug hover:underline',
										isDone(task.status) && 'text-muted-foreground line-through'
									)}
									onclick={() => onSelectTask(task.id)}
								>
									{task.title}
								</button>
							{:else}
								<p
									class={cn(
										'text-sm font-medium leading-snug',
										isDone(task.status) && 'text-muted-foreground line-through'
									)}
								>
									{task.title}
								</p>
							{/if}
						</div>
						<p class="text-muted-foreground mt-1 truncate text-xs">
							{#if task.relatedTo}{task.relatedTo} · {/if}Due {task.dueOn}
						</p>
					</div>
					<StatusBadge status={task.status} class="shrink-0" />
				</li>
			{/each}
		</ul>
	{/if}
</section>
