<script lang="ts">
	import PinIcon from '@lucide/svelte/icons/pin';
	import type { NoteColor } from '$lib/schemas/note.js';
	import NoteColorDot from './note-color-dot.svelte';

	export interface NoteTitleLinkProps {
		id: string;
		title: string;
		color: NoteColor;
		pinned?: boolean;
	}

	let { id, title, color, pinned = false }: NoteTitleLinkProps = $props();
</script>

<a href="/notes/{id}" class="inline-flex max-w-full items-center gap-2 hover:underline">
	<NoteColorDot {color} />
	<span class="truncate font-medium">{title}</span>
	{#if pinned}
		<PinIcon class="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />
	{/if}
</a>
