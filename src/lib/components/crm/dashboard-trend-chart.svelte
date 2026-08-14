<script lang="ts">
	import { cn } from '$lib/utils.js';

	export interface TrendPoint {
		label: string;
		cashCents: number;
		bookedCents: number;
	}

	export interface DashboardTrendChartProps {
		points: TrendPoint[];
		cashLabel?: string;
		bookedLabel?: string;
		class?: string;
	}

	let {
		points,
		cashLabel = 'Cash',
		bookedLabel = 'Booked',
		class: className
	}: DashboardTrendChartProps = $props();

	const width = 320;
	const height = 140;
	const padX = 8;
	const padY = 12;
	const chartW = width - padX * 2;
	const chartH = height - padY * 2;

	const maxValue = $derived(
		Math.max(1, ...points.flatMap((p) => [p.cashCents, p.bookedCents]))
	);

	function xAt(index: number, count: number): number {
		if (count <= 1) return padX + chartW / 2;
		return padX + (index / (count - 1)) * chartW;
	}

	function yAt(value: number): number {
		return padY + chartH - (value / maxValue) * chartH;
	}

	function pathFor(values: number[]): string {
		if (values.length === 0) return '';
		return values
			.map((value, index) => {
				const x = xAt(index, values.length);
				const y = yAt(value);
				return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	const cashPath = $derived(pathFor(points.map((p) => p.cashCents)));
	const bookedPath = $derived(pathFor(points.map((p) => p.bookedCents)));
</script>

<section
	class={cn(
		'bg-card rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="mb-3 flex items-center justify-between gap-3">
		<h2 class="text-sm font-semibold tracking-tight">Cash vs booked</h2>
		<div class="text-muted-foreground flex items-center gap-3 text-xs">
			<span class="inline-flex items-center gap-1.5">
				<span class="bg-foreground inline-block size-2 rounded-full"></span>
				{cashLabel}
			</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="bg-foreground/35 inline-block size-2 rounded-full"></span>
				{bookedLabel}
			</span>
		</div>
	</div>
	{#if points.length === 0}
		<p class="text-muted-foreground text-sm">No monthly activity yet.</p>
	{:else}
		<svg viewBox={`0 0 ${width} ${height}`} class="text-foreground h-36 w-full" role="img">
			<title>Cash collected versus booked invoice totals by month</title>
			{#if bookedPath}
				<path
					d={bookedPath}
					fill="none"
					stroke="currentColor"
					stroke-opacity="0.35"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/if}
			{#if cashPath}
				<path
					d={cashPath}
					fill="none"
					stroke="currentColor"
					stroke-width="2.25"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/if}
		</svg>
		<div class="text-muted-foreground mt-1 flex justify-between gap-2 text-[10px] tracking-wide">
			{#each points as point (point.label)}
				<span class="min-w-0 truncate">{point.label}</span>
			{/each}
		</div>
	{/if}
</section>
