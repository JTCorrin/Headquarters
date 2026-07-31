<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	export interface AiAssistActionProps {
		label: string;
		busy?: boolean;
		disabled?: boolean;
		variant?: 'outline' | 'secondary' | 'ghost';
		size?: 'sm' | 'default';
		class?: string;
		onclick?: () => void;
	}

	let {
		label,
		busy = false,
		disabled = false,
		variant = 'outline',
		size = 'sm',
		class: className,
		onclick
	}: AiAssistActionProps = $props();
</script>

<Button
	type="button"
	{variant}
	{size}
	disabled={disabled || busy}
	class={cn('gap-1.5', className)}
	{onclick}
>
	{#if busy}
		<LoaderCircleIcon class="size-3.5 animate-spin" />
	{:else}
		<SparklesIcon class="size-3.5" />
	{/if}
	{busy ? 'Working…' : label}
</Button>
