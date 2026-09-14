<script lang="ts">
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import type { NoteListItem, NotesViewMode } from '$lib/schemas/note.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import NotesGrid from './notes-grid.svelte';
	import NotesTable from './notes-table.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';

	export interface NotesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		items: NoteListItem[];
		viewMode?: NotesViewMode;
		/** Controlled search text; the container debounces and queries the API. */
		searchQuery?: string;
		searching?: boolean;
		creating?: boolean;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onViewModeChange?: (mode: NotesViewMode) => void;
		onSearchChange?: (value: string) => void;
		onCreateNote?: () => void | Promise<void>;
		onOpenNote?: (id: string) => void;
		onTogglePin?: (id: string) => void;
		onDeleteNote?: (id: string) => void;
	}

	let {
		orgName,
		navGroups,
		items,
		viewMode = 'grid',
		searchQuery = '',
		searching = false,
		creating = false,
		showNav = true,
		class: className,
		onViewModeChange,
		onSearchChange,
		onCreateNote,
		onOpenNote,
		onTogglePin,
		onDeleteNote
	}: NotesListPageProps = $props();

	const emptyMessage = $derived(
		searchQuery.trim().length > 0
			? `No notes match “${searchQuery.trim()}”.`
			: 'No notes yet — create your first note.'
	);
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col', className)}
>
	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
			<PageHeader
				title="Notes"
				description="Private to you — nobody else in the organisation can see these."
			>
				{#snippet actions()}
					<div
						class="inline-flex items-center rounded-md border p-0.5"
						role="group"
						aria-label="Notes layout"
					>
						<Button
							type="button"
							variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
							size="sm"
							class="h-7 px-2"
							aria-pressed={viewMode === 'grid'}
							aria-label="Grid view"
							onclick={() => onViewModeChange?.('grid')}
						>
							<LayoutGridIcon class="size-4" />
						</Button>
						<Button
							type="button"
							variant={viewMode === 'table' ? 'secondary' : 'ghost'}
							size="sm"
							class="h-7 px-2"
							aria-pressed={viewMode === 'table'}
							aria-label="Table view"
							onclick={() => onViewModeChange?.('table')}
						>
							<ListIcon class="size-4" />
						</Button>
					</div>
					<Button
						type="button"
						size="sm"
						disabled={creating}
						onclick={() => void onCreateNote?.()}
						data-testid="notes-new"
					>
						<PlusIcon class="size-4" />
						{creating ? 'Creating…' : 'New note'}
					</Button>
				{/snippet}
			</PageHeader>

			<div class="relative max-w-md">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="search"
					placeholder="Search notes…"
					value={searchQuery}
					oninput={(event) => onSearchChange?.(event.currentTarget.value)}
					class="pr-9 pl-9"
					aria-label="Search notes"
					data-testid="notes-search"
				/>
				{#if searchQuery}
					<button
						type="button"
						class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
						aria-label="Clear search"
						onclick={() => onSearchChange?.('')}
					>
						<XIcon class="size-4" />
					</button>
				{/if}
				{#if searching}
					<span class="sr-only" role="status">Searching…</span>
				{/if}
			</div>

			{#if viewMode === 'table'}
				<NotesTable rows={items} {emptyMessage} {onOpenNote} {onDeleteNote} />
			{:else}
				<NotesGrid {items} {emptyMessage} {onTogglePin} {onDeleteNote} />
			{/if}
		</div>
	</main>
</AppSidebarFrame>
