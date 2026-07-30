<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';

	export interface LineItemRow {
		id: string;
		productSku?: string;
		description: string;
		qty: string;
		unitPrice: string;
		total: string;
	}

	export interface LineItemsTableProps {
		rows: LineItemRow[];
		currency?: string;
		onRemove?: (id: string) => void;
		/** Custom header control (e.g. Add line item drawer trigger). */
		headerActions?: Snippet;
		class?: string;
	}

	let {
		rows,
		currency = 'GBP',
		onRemove,
		headerActions,
		class: className
	}: LineItemsTableProps = $props();

	const subtotal = $derived(
		rows.reduce((sum, row) => {
			const qty = Number(row.qty) || 0;
			const unit = Number(row.unitPrice) || 0;
			return sum + qty * unit;
		}, 0)
	);
</script>

<div
	class={cn(
		'bg-card overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
		<div class="min-w-0">
			<p class="text-sm font-semibold tracking-tight">Line items</p>
			<p class="text-muted-foreground text-xs">{rows.length} line(s)</p>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<p class="text-sm font-medium tabular-nums">
				{currency}
				{subtotal.toLocaleString(undefined, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2
				})}
			</p>
			{#if headerActions}
				{@render headerActions()}
			{:else}
				<Button type="button" size="sm" variant="outline" disabled>
					<PlusIcon class="size-3.5" />
					Add line item
				</Button>
			{/if}
		</div>
	</div>

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Product</Table.Head>
				<Table.Head>Description</Table.Head>
				<Table.Head class="text-end">Qty</Table.Head>
				<Table.Head class="text-end">Unit</Table.Head>
				<Table.Head class="text-end">Total</Table.Head>
				{#if onRemove}<Table.Head class="w-16"></Table.Head>{/if}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.id)}
				<Table.Row>
					<Table.Cell class="text-muted-foreground text-xs">{row.productSku ?? '—'}</Table.Cell>
					<Table.Cell class="font-medium">{row.description}</Table.Cell>
					<Table.Cell class="text-end tabular-nums">{row.qty}</Table.Cell>
					<Table.Cell class="text-end tabular-nums">{row.unitPrice}</Table.Cell>
					<Table.Cell class="text-end tabular-nums">{row.total}</Table.Cell>
					{#if onRemove}
						<Table.Cell>
							<Button type="button" variant="ghost" size="xs" onclick={() => onRemove(row.id)}>
								Remove
							</Button>
						</Table.Cell>
					{/if}
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell
						colspan={onRemove ? 6 : 5}
						class="text-muted-foreground h-24 text-center text-sm"
					>
						No line items yet — use Add line item.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
