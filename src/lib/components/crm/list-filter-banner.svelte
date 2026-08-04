<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ListFilterBannerProps {
		label: string;
		onClear?: () => void;
		class?: string;
	}

	let { label, onClear, class: className }: ListFilterBannerProps = $props();
</script>

<div
	class={cn(
		'bg-muted/40 text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-foreground/5',
		className
	)}
	data-testid="list-filter-banner"
	role="status"
>
	<p>{label}</p>
	{#if onClear}
		<Button type="button" size="sm" variant="ghost" data-testid="list-filter-clear" onclick={onClear}>
			Clear filter
		</Button>
	{/if}
</div>
