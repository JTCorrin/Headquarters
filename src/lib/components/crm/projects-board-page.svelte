<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProjectFormData } from '$lib/schemas/project.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ProjectsBoard, { type ProjectCard } from './projects-board.svelte';
	import ProjectFormDrawer from './project-form-drawer.svelte';
	import type { ProjectClientOption } from './project-form.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProjectsBoardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		projects: ProjectCard[];
		clients: ProjectClientOption[];
		form: SuperForm<ProjectFormData>;
		drawerOpen?: boolean;
		clientFilter?: string;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		projects,
		clients,
		form,
		drawerOpen = $bindable(false),
		clientFilter = $bindable('all'),
		class: className
	}: ProjectsBoardPageProps = $props();

	const filtered = $derived(
		clientFilter === 'all'
			? projects
			: projects.filter((p) => p.clientId === clientFilter)
	);
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Work"
				title="Projects"
				description="Client-attachable boards — drag projects between stages, open one for its inner kanban."
			>
				{#snippet actions()}
					<ProjectFormDrawer bind:open={drawerOpen} {form} {clients}>
						{#snippet trigger()}
							<Button type="button" size="sm">New project</Button>
						{/snippet}
					</ProjectFormDrawer>
				{/snippet}
			</PageHeader>

			<div class="flex flex-wrap items-center gap-2">
				<span class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
					>Client</span
				>
				<button
					type="button"
					class={cn(
						'rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors',
						clientFilter === 'all'
							? 'bg-foreground text-background ring-foreground'
							: 'bg-background text-foreground ring-foreground/10 hover:bg-muted'
					)}
					onclick={() => (clientFilter = 'all')}
				>
					All
				</button>
				{#each clients as client (client.id)}
					<button
						type="button"
						class={cn(
							'rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors',
							clientFilter === client.id
								? 'bg-foreground text-background ring-foreground'
								: 'bg-background text-foreground ring-foreground/10 hover:bg-muted'
						)}
						onclick={() => (clientFilter = client.id)}
					>
						{client.name}
					</button>
				{/each}
			</div>

			<ProjectsBoard projects={filtered} class="min-h-[480px]" />
		</div>
	</main>
</div>
