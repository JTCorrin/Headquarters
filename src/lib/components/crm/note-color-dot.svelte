<script lang="ts">
	import { NOTE_COLORS, type NoteColor } from '$lib/schemas/note.js';
	import { cn } from '$lib/utils.js';

	export interface NoteColorDotProps {
		color: NoteColor;
		class?: string;
	}

	let { color, class: className }: NoteColorDotProps = $props();
	const style = $derived(NOTE_COLORS[color] ?? NOTE_COLORS.yellow);
</script>

<span
	class={cn('inline-block size-3 shrink-0 rounded-full', style.swatch, className)}
	role="img"
	aria-label={style.label}
	title={style.label}
></span>
