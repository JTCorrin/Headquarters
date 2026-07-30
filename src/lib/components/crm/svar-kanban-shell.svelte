<script lang="ts">
	import {
		Kanban,
		Willow,
		WillowDark,
		type KanbanCard,
		type CardShape,
		type ColumnConfig
	} from '@svar-ui/svelte-kanban';
	import { cn } from '$lib/utils.js';

	export interface SvarKanbanShellProps {
		cards: KanbanCard[];
		columns: ColumnConfig[];
		card?: CardShape;
		readonly?: boolean;
		class?: string;
	}

	let {
		cards,
		columns,
		card = {
			priority: false,
			progress: false,
			deadline: false,
			users: false,
			tags: false,
			attachments: false,
			comments: false,
			description: true,
			menu: false
		},
		readonly = false,
		class: className
	}: SvarKanbanShellProps = $props();

	let dark = $state(false);

	$effect(() => {
		const root = document.documentElement;
		const sync = () => {
			dark = root.classList.contains('dark');
		};
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	});
</script>

<div
	class={cn('crm-svar-kanban h-full min-h-[420px] w-full overflow-hidden rounded-3xl', className)}
>
	{#if dark}
		<WillowDark>
			<div class="crm-svar-kanban-theme h-full">
				<Kanban {cards} {columns} {card} {readonly} />
			</div>
		</WillowDark>
	{:else}
		<Willow>
			<div class="crm-svar-kanban-theme h-full">
				<Kanban {cards} {columns} {card} {readonly} />
			</div>
		</Willow>
	{/if}
</div>

<style>
	/* Map SVAR tokens toward shadcn Luma without fighting Tailwind elsewhere. */
	.crm-svar-kanban-theme {
		--wx-kanban-bg: transparent;
		--wx-kanban-column-bg: color-mix(in oklab, var(--muted) 55%, transparent);
		--wx-kanban-card-bg: var(--card);
		--wx-kanban-border-color: color-mix(in oklab, var(--foreground) 10%, transparent);
		--wx-kanban-card-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
		--wx-kanban-card-shadow-hover: 0 8px 20px rgb(0 0 0 / 0.08);
		--wx-kanban-drop-placeholder-bg: color-mix(in oklab, var(--primary) 12%, transparent);
		--wx-color-primary: var(--primary);
		--wx-color-font: var(--foreground);
		--wx-color-font-alt: var(--muted-foreground);
		--wx-background: var(--card);
		--wx-background-alt: var(--muted);
		--wx-background-hover: var(--accent);
		--wx-border-radius: 1rem;
		--wx-radius-major: 1.5rem;
		height: 100%;
		min-height: 420px;
	}

	.crm-svar-kanban-theme :global(.wx-kanban),
	.crm-svar-kanban-theme :global(.wx-board) {
		height: 100%;
		min-height: 420px;
	}
</style>
