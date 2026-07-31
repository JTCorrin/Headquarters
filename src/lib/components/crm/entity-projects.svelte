<script lang="ts">
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface EntityProject {
		id: string;
		name: string;
		status: string;
		owner?: string;
		cardCount?: number;
		updatedAt?: string;
	}

	export interface EntityProjectsProps {
		projects: EntityProject[];
		class?: string;
		onNewProject?: () => void;
	}

	let { projects, class: className, onNewProject }: EntityProjectsProps = $props();
</script>

<section class={cn('space-y-4', className)}>
	<div class="flex items-center justify-between gap-3">
		<div>
			<h3 class="text-sm font-semibold tracking-tight">Projects</h3>
			<p class="text-muted-foreground text-xs">Kanban boards attached to this client.</p>
		</div>
		{#if onNewProject}
			<Button type="button" size="sm" variant="outline" onclick={onNewProject}>New project</Button>
		{/if}
	</div>

	{#if projects.length === 0}
		<p class="text-muted-foreground rounded-2xl px-4 py-8 text-center text-sm ring-1 ring-foreground/5">
			No projects yet — attach a board when delivery work starts.
		</p>
	{:else}
		<ul class="divide-border divide-y rounded-2xl ring-1 ring-foreground/5">
			{#each projects as project (project.id)}
				<li class="flex items-center justify-between gap-3 px-4 py-3">
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{project.name}</p>
						<p class="text-muted-foreground truncate text-xs">
							{[
								project.owner ? `Owner ${project.owner}` : null,
								project.cardCount !== undefined ? `${project.cardCount} cards` : null,
								project.updatedAt
							]
								.filter(Boolean)
								.join(' · ')}
						</p>
					</div>
					<StatusBadge status={project.status} />
				</li>
			{/each}
		</ul>
	{/if}
</section>
