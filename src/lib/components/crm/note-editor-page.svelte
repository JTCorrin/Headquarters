<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { Editor } from '$lib/components/edra/tiptap/Editor.js';
	import { Edra } from '$lib/components/edra/shadcn/index.js';
	import { noteSaveStatusLabel, type NoteSaveStatus } from '$lib/crm/notes.js';
	import { NOTE_COLORS, noteColors, type NoteColor } from '$lib/schemas/note.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { cn } from '$lib/utils.js';

	export interface NoteEditorPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		/** Tiptap editor instance; undefined during SSR. */
		editor: Editor | undefined;
		title: string;
		color: NoteColor;
		pinned: boolean;
		saveStatus?: NoteSaveStatus;
		saveError?: string | null;
		actionBusy?: boolean;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onBack?: () => void;
		onTitleChange?: (value: string) => void;
		onColorChange?: (color: NoteColor) => void;
		onTogglePin?: () => void;
		onDelete?: () => void | Promise<void>;
		onRetrySave?: () => void | Promise<void>;
		onReload?: () => void | Promise<void>;
	}

	let {
		orgName,
		navGroups,
		editor,
		title,
		color,
		pinned,
		saveStatus = 'idle',
		saveError = null,
		actionBusy = false,
		showNav = true,
		class: className,
		onBack,
		onTitleChange,
		onColorChange,
		onTogglePin,
		onDelete,
		onRetrySave,
		onReload
	}: NoteEditorPageProps = $props();

	const style = $derived(NOTE_COLORS[color] ?? NOTE_COLORS.yellow);
	const statusLabel = $derived(noteSaveStatusLabel(saveStatus));
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col', className)}
>
	<main class="flex min-w-0 flex-1 flex-col">
		<div class="flex flex-1 flex-col gap-4 px-4 py-6 sm:px-6 md:px-8">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="-ml-2"
						data-testid="note-back"
						onclick={() => onBack?.()}
					>
						<ArrowLeftIcon class="size-4" />
						Notes
					</Button>
					<span
						class={cn(
							'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
							saveStatus === 'error' && 'text-destructive',
							saveStatus === 'conflict' && 'text-amber-600 dark:text-amber-400'
						)}
						role="status"
						aria-live="polite"
						data-testid="note-save-status"
						data-status={saveStatus}
					>
						{#if saveStatus === 'saving'}
							<LoaderCircleIcon class="size-3.5 animate-spin" />
						{:else if saveStatus === 'saved'}
							<CheckIcon class="size-3.5" />
						{:else if saveStatus === 'error' || saveStatus === 'conflict'}
							<CircleAlertIcon class="size-3.5" />
						{/if}
						{statusLabel}
						{#if saveStatus === 'error' && onRetrySave}
							<button
								type="button"
								class="underline underline-offset-2"
								onclick={() => void onRetrySave()}
							>
								Retry
							</button>
						{:else if saveStatus === 'conflict' && onReload}
							<button
								type="button"
								class="underline underline-offset-2"
								onclick={() => void onReload()}
							>
								Reload
							</button>
						{/if}
					</span>
				</div>

				<div class="flex items-center gap-1">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="sm"
									aria-label="Note colour: {style.label}"
									data-testid="note-color-trigger"
								>
									<span class={cn('size-3.5 rounded-full', style.swatch)}></span>
									<PaletteIcon class="size-4" />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Label>Colour</DropdownMenu.Label>
							<DropdownMenu.RadioGroup
								value={color}
								onValueChange={(value) => onColorChange?.(value as NoteColor)}
							>
								{#each noteColors as option (option)}
									<DropdownMenu.RadioItem value={option} data-testid="note-color-{option}">
										<span class={cn('mr-2 size-3 rounded-full', NOTE_COLORS[option].swatch)}></span>
										{NOTE_COLORS[option].label}
									</DropdownMenu.RadioItem>
								{/each}
							</DropdownMenu.RadioGroup>
						</DropdownMenu.Content>
					</DropdownMenu.Root>

					<Button
						variant="ghost"
						size="sm"
						aria-pressed={pinned}
						aria-label={pinned ? 'Unpin note' : 'Pin note'}
						data-testid="note-pin"
						onclick={() => onTogglePin?.()}
					>
						{#if pinned}
							<PinOffIcon class="size-4" />
							Unpin
						{:else}
							<PinIcon class="size-4" />
							Pin
						{/if}
					</Button>

					{#if onDelete}
						<Button
							variant="ghost"
							size="sm"
							class="text-destructive hover:text-destructive"
							disabled={actionBusy}
							data-testid="note-delete"
							onclick={() => void onDelete()}
						>
							<Trash2Icon class="size-4" />
							Delete
						</Button>
					{/if}
				</div>
			</div>

			{#if saveError}
				<p class="text-sm text-destructive" role="alert">{saveError}</p>
			{/if}

			<div
				class={cn(
					'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm',
					style.card
				)}
				data-testid="note-surface"
				data-color={color}
			>
				<input
					type="text"
					value={title}
					placeholder="Untitled"
					maxlength="200"
					aria-label="Note title"
					data-testid="note-title"
					class="w-full bg-transparent px-8 pt-6 pb-2 text-2xl font-semibold tracking-tight outline-none placeholder:opacity-50"
					oninput={(event) => onTitleChange?.(event.currentTarget.value)}
				/>
				<Edra {editor}>
					<Edra.Toolbar
						class="h-fit max-w-full scrollbar-none overflow-x-auto border-y border-black/5 bg-white/40 p-1 dark:border-white/10 dark:bg-black/20"
					/>
					<Edra.Content
						class="min-h-[50vh] w-full flex-1 cursor-auto px-8 py-4 text-base *:outline-none"
					/>
					<Edra.DragHandle />
				</Edra>
			</div>
		</div>
	</main>
</AppSidebarFrame>
