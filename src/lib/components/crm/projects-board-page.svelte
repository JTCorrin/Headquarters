<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		INTERNAL_PROJECT_CLIENT_ID,
		INTERNAL_PROJECT_LABEL,
		type ProjectFormData
	} from '$lib/schemas/project.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ProjectsBoard, {
		type ProjectBoardMove,
		type ProjectCard
	} from './projects-board.svelte';
	import ProjectFormDrawer from './project-form-drawer.svelte';
	import type { ProjectClientOption } from './project-form.svelte';
	import { cn } from '$lib/utils.js';

	export interface ProjectsBoardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		projects: ProjectCard[];
		clients: ProjectClientOption[];
		form: SuperForm<ProjectFormData>;
		drawerOpen?: boolean;
		clientFilter?: string;
		/** When false, omit AppNav (shell already renders it). */
		showNav?: boolean;
		class?: string;
		onSelectProject?: (id: string) => void;
		onMoveProject?: (move: ProjectBoardMove) => void | Promise<void>;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		projects,
		clients,
		form,
		drawerOpen = $bindable(false),
		clientFilter = $bindable('all'),
		showNav = true,
		class: className,
		onSelectProject,
		onMoveProject,
		onValidSubmit
	}: ProjectsBoardPageProps = $props();

	const filterOptions = $derived([
		{ id: INTERNAL_PROJECT_CLIENT_ID, name: INTERNAL_PROJECT_LABEL },
		...clients
	]);
	const filtered = $derived(
		clientFilter === 'all'
			? projects
			: projects.filter((p) => p.clientId === clientFilter)
	);
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
			<PageHeader title="Projects">
				{#snippet actions()}
					<ProjectFormDrawer
						bind:open={drawerOpen}
						{form}
						{clients}
						{onValidSubmit}
					/>
				{/snippet}
			</PageHeader>

			<div class="flex flex-wrap items-center gap-2">
				<span class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
					>Attach to</span
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
				{#each filterOptions as client (client.id)}
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

			<ProjectsBoard
				projects={filtered}
				{onSelectProject}
				{onMoveProject}
				class="min-h-[480px]"
			/>
		</div>
	</main>
</div>
