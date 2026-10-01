<script lang="ts">
	import { cn } from '$lib/utils.js';

	export interface OrgLogoMarkProps {
		name: string;
		logoUrl?: string | null;
		class?: string;
	}

	let { name, logoUrl = null, class: className }: OrgLogoMarkProps = $props();

	function initials(value: string): string {
		const parts = value.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
		return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
	}

	function hideBrokenLogo(event: Event) {
		const img = event.currentTarget;
		if (img instanceof HTMLImageElement) img.remove();
	}
</script>

<span
	class={cn(
		'relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md',
		className
	)}
	data-testid="org-logo-mark"
	aria-hidden="true"
>
	<span
		class="flex size-full items-center justify-center bg-muted text-[10px] font-semibold text-muted-foreground"
	>
		{initials(name)}
	</span>
	{#if logoUrl}
		<img
			src={logoUrl}
			alt=""
			class="absolute inset-0 size-full bg-background object-contain p-0.5"
			data-testid="org-logo-image"
			onerror={hideBrokenLogo}
		/>
	{/if}
</span>
