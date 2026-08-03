<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import StatusBadge from './status-badge.svelte';
	import ProjectWorkspaceBoard, {
		type ProjectCardBoardMove,
		type ProjectWorkCard
	} from './project-workspace-board.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProjectWorkspacePageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		projectName: string;
		clientName: string;
		clientHref?: string;
		status: string;
		owner?: string;
		description?: string;
		cards: ProjectWorkCard[];
		columns?: { id: string; label: string }[];
		/** When false, omit AppNav (shell already renders it). */
		showNav?: boolean;
		class?: string;
		onMoveCard?: (move: ProjectCardBoardMove) => void | Promise<void>;
		onAddCard?: () => void;
	}

	let {
		orgName,
		navGroups,
		projectName,
		clientName,
		clientHref,
		status,
		owner,
		description,
		cards,
		columns,
		showNav = true,
		class: className,
		onMoveCard,
		onAddCard
	}: ProjectWorkspacePageProps = $props();
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
				breadcrumb="Projects / {clientName}"
				title={projectName}
				description={description ?? 'Inner kanban for delivery work on this client project.'}
				status={status}
			>
				{#snippet actions()}
					{#if owner}
						<span class="text-muted-foreground hidden text-sm sm:inline">Owner {owner}</span>
					{/if}
					{#if clientHref}
						<Button variant="outline" size="sm" href={clientHref}>Open client</Button>
					{/if}
					{#if onAddCard}
						<Button size="sm" onclick={onAddCard}>Add card</Button>
					{/if}
				{/snippet}
			</PageHeader>

			<div class="flex flex-wrap items-center gap-2">
				<span class="text-muted-foreground text-xs">Attached to</span>
				<StatusBadge status={clientName} />
			</div>

			<ProjectWorkspaceBoard {cards} {columns} {onMoveCard} class="min-h-[480px]" />
		</div>
	</main>
</div>
