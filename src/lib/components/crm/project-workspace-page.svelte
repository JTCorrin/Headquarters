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
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

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
		actionBusy?: boolean;
		class?: string;
		onMoveCard?: (move: ProjectCardBoardMove) => void | Promise<void>;
		onAddCard?: () => void;
		onSelectCard?: (id: string) => void;
		onEdit?: () => void;
		onDelete?: () => void;
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
		actionBusy = false,
		class: className,
		onMoveCard,
		onAddCard,
		onSelectCard,
		onEdit,
		onDelete
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
			<PageHeader title={projectName} status={status}>
				{#snippet actions()}
					{#if owner}
						<span class="text-muted-foreground hidden text-sm sm:inline">Owner {owner}</span>
					{/if}
					{#if onEdit}
						<Button
							variant="outline"
							size="sm"
							disabled={actionBusy}
							onclick={() => onEdit?.()}
						>
							<PencilIcon class="size-3.5" />
							Edit
						</Button>
					{/if}
					{#if onDelete}
						<Button
							variant="outline"
							size="sm"
							disabled={actionBusy}
							onclick={() => onDelete?.()}
						>
							<Trash2Icon class="size-3.5" />
							Delete
						</Button>
					{/if}
					{#if clientHref}
						<Button variant="outline" size="sm" href={clientHref}>Open client</Button>
					{/if}
					{#if onAddCard}
						<Button size="sm" disabled={actionBusy} onclick={onAddCard}>Add card</Button>
					{/if}
				{/snippet}
			</PageHeader>

			<div class="flex flex-wrap items-center gap-2">
				<span class="text-muted-foreground text-xs">Attached to</span>
				<StatusBadge status={clientName} />
			</div>

			<ProjectWorkspaceBoard
				{cards}
				{columns}
				{onMoveCard}
				{onSelectCard}
				class="min-h-[480px]"
			/>
		</div>
	</main>
</div>
