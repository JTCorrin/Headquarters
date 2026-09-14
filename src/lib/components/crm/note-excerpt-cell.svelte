<script lang="ts">
	export interface NoteExcerptCellProps {
		excerpt: string;
	}

	let { excerpt }: NoteExcerptCellProps = $props();
</script>

{#if excerpt}
	<span class="block max-w-[32rem] truncate text-muted-foreground" title={excerpt}>{excerpt}</span>
{:else}
	<span class="text-muted-foreground italic">Empty note</span>
{/if}
