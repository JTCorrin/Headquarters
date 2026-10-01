<script lang="ts">
	import { cn } from '$lib/utils.js';

	export interface AgingBar {
		label: string;
		cents: number;
		count: number;
		display: string;
	}

	export interface DashboardAgingChartProps {
		bars: AgingBar[];
		class?: string;
	}

	let { bars, class: className }: DashboardAgingChartProps = $props();

	const maxCents = $derived(Math.max(1, ...bars.map((b) => b.cents)));
</script>

<section
	class={cn('rounded-3xl bg-card p-5 ring-1 ring-foreground/5 dark:ring-foreground/10', className)}
>
	<h2 class="mb-4 text-sm font-semibold tracking-tight">AR aging</h2>
	{#if bars.every((b) => b.cents === 0)}
		<p class="text-sm text-muted-foreground">No open receivables.</p>
	{:else}
		<ul class="m-0 list-none space-y-3 p-0">
			{#each bars as bar (bar.label)}
				<li>
					<div class="mb-1 flex items-baseline justify-between gap-3 text-xs">
						<span class="text-muted-foreground">{bar.label}</span>
						<span class="tabular-nums"
							>{bar.display}
							<span class="text-muted-foreground">· {bar.count}</span></span
						>
					</div>
					<div class="h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-foreground/80 transition-[width]"
							style={`width: ${(bar.cents / maxCents) * 100}%`}
						></div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
