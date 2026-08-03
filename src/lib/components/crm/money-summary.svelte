<script lang="ts">
	import StatusBadge from './status-badge.svelte';
	import { cn } from '$lib/utils.js';

	export interface MoneySummaryItem {
		id: string;
		kind: 'quote' | 'invoice' | 'payment';
		label: string;
		amount: string;
		status: string;
		date: string;
		/** When set, the row links to the document detail route. */
		href?: string;
	}

	export interface MoneySummaryProps {
		items: MoneySummaryItem[];
		emptyMessage?: string;
		class?: string;
	}

	let {
		items,
		emptyMessage = 'No quotes, invoices, or payments yet.',
		class: className
	}: MoneySummaryProps = $props();

	const kindLabel: Record<MoneySummaryItem['kind'], string> = {
		quote: 'Quote',
		invoice: 'Invoice',
		payment: 'Payment'
	};
</script>

<div class={cn('space-y-3', className)}>
	{#each items as item (item.id)}
		{#if item.href}
			<a
				href={item.href}
				class="bg-card hover:bg-muted/40 flex items-start justify-between gap-3 rounded-2xl px-4 py-3 ring-1 ring-foreground/5 transition-colors dark:ring-foreground/10"
				data-testid="money-summary-row"
			>
				<div class="min-w-0 space-y-1">
					<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
						{kindLabel[item.kind]}
					</p>
					<p class="truncate text-sm font-semibold">{item.label}</p>
					<p class="text-muted-foreground text-xs">{item.date}</p>
				</div>
				<div class="flex shrink-0 flex-col items-end gap-2">
					<span class="text-sm font-medium tabular-nums">{item.amount}</span>
					<StatusBadge status={item.status} />
				</div>
			</a>
		{:else}
			<div
				class="bg-card flex items-start justify-between gap-3 rounded-2xl px-4 py-3 ring-1 ring-foreground/5 dark:ring-foreground/10"
				data-testid="money-summary-row"
			>
				<div class="min-w-0 space-y-1">
					<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
						{kindLabel[item.kind]}
					</p>
					<p class="truncate text-sm font-semibold">{item.label}</p>
					<p class="text-muted-foreground text-xs">{item.date}</p>
				</div>
				<div class="flex shrink-0 flex-col items-end gap-2">
					<span class="text-sm font-medium tabular-nums">{item.amount}</span>
					<StatusBadge status={item.status} />
				</div>
			</div>
		{/if}
	{:else}
		<p class="text-muted-foreground text-sm">{emptyMessage}</p>
	{/each}
</div>
