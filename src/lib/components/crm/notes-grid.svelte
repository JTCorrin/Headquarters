<script lang="ts">
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { NOTE_COLORS, type NoteListItem } from '$lib/schemas/note.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface NotesGridProps {
		items: NoteListItem[];
		class?: string;
		emptyMessage?: string;
		onTogglePin?: (id: string) => void;
		onDeleteNote?: (id: string) => void;
	}

	let {
		items,
		class: className,
		emptyMessage = 'No notes yet.',
		onTogglePin,
		onDeleteNote
	}: NotesGridProps = $props();
</script>

{#if items.length === 0}
	<p class="py-10 text-center text-sm text-muted-foreground" data-testid="notes-grid-empty">
		{emptyMessage}
	</p>
{:else}
	<div
		class={cn('columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4', className)}
		data-testid="notes-grid"
	>
		{#each items as item (item.id)}
			{@const style = NOTE_COLORS[item.color] ?? NOTE_COLORS.yellow}
			<article
				class={cn(
					'group relative mb-4 break-inside-avoid rounded-lg border shadow-sm transition-shadow hover:shadow-md',
					style.card
				)}
				data-testid="note-card"
				data-note-id={item.id}
				data-pinned={item.pinned ? 'true' : 'false'}
			>
				<a href="/notes/{item.id}" class="block p-4 pb-3 outline-none focus-visible:ring-2">
					<h3 class="mb-2 line-clamp-2 pr-8 text-base leading-snug font-semibold">
						{item.displayTitle}
					</h3>
					{#if item.excerpt}
						<p class="line-clamp-[8] text-sm/relaxed whitespace-pre-line opacity-90">
							{item.excerpt}
						</p>
					{:else}
						<p class="text-sm italic opacity-60">Empty note</p>
					{/if}
					<p class="mt-3 text-xs opacity-70">{item.updatedLabel}</p>
				</a>

				{#if item.pinned}
					<PinIcon
						class="pointer-events-none absolute top-3.5 right-3.5 size-4 fill-current opacity-80 group-focus-within:opacity-0 group-hover:opacity-0"
						aria-label="Pinned"
					/>
				{/if}

				<div
					class="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
				>
					{#if onTogglePin}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="size-7 hover:bg-black/10 dark:hover:bg-white/10"
							aria-label={item.pinned ? 'Unpin note' : 'Pin note'}
							aria-pressed={item.pinned}
							onclick={() => onTogglePin(item.id)}
						>
							{#if item.pinned}
								<PinOffIcon class="size-4" />
							{:else}
								<PinIcon class="size-4" />
							{/if}
						</Button>
					{/if}
					{#if onDeleteNote}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="size-7 hover:bg-black/10 dark:hover:bg-white/10"
							aria-label="Delete note"
							onclick={() => onDeleteNote(item.id)}
						>
							<Trash2Icon class="size-4" />
						</Button>
					{/if}
				</div>
			</article>
		{/each}
	</div>
{/if}
