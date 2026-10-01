<script lang="ts">
	import { cn } from '$lib/utils.js';

	export interface PipelineBar {
		label: string;
		count: number;
		display: string;
	}

	export interface DashboardPipelineChartProps {
		bars: PipelineBar[];
		class?: string;
	}

	let { bars, class: className }: DashboardPipelineChartProps = $props();

	const maxCount = $derived(Math.max(1, ...bars.map((b) => b.count)));
</script>

<section
	class={cn('rounded-3xl bg-card p-5 ring-1 ring-foreground/5 dark:ring-foreground/10', className)}
>
	<h2 class="mb-4 text-sm font-semibold tracking-tight">Quote pipeline</h2>
	{#if bars.every((b) => b.count === 0)}
		<p class="text-sm text-muted-foreground">No active quotes in default currency.</p>
	{:else}
		<ul class="m-0 list-none space-y-3 p-0">
			{#each bars as bar (bar.label)}
				<li>
					<div class="mb-1 flex items-baseline justify-between gap-3 text-xs">
						<span class="text-muted-foreground">{bar.label}</span>
						<span class="tabular-nums"
							>{bar.count}
							<span class="text-muted-foreground">· {bar.display}</span></span
						>
					</div>
					<div class="h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-foreground/70 transition-[width]"
							style={`width: ${(bar.count / maxCount) * 100}%`}
						></div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
