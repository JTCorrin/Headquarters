<script lang="ts">
	import type { RecurringLineRow } from '$lib/api/v1/mappers.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface RecurringLinesTableProps {
		rows: RecurringLineRow[];
		readonly?: boolean;
		onRemove?: (id: string) => void;
		headerActions?: Snippet;
		class?: string;
	}

	let {
		rows = [],
		readonly = false,
		onRemove,
		headerActions,
		class: className
	}: RecurringLinesTableProps = $props();
</script>

<div
	class={cn(
		'bg-card overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
		<div class="min-w-0">
			<h3 class="text-sm font-medium">Schedule lines</h3>
			<p class="text-muted-foreground text-xs">At least one line is required before activation.</p>
		</div>
		{#if headerActions}
			{@render headerActions()}
		{/if}
	</div>

	{#if rows.length === 0}
		<p class="text-muted-foreground px-4 py-8 text-center text-sm">No lines yet.</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Description</Table.Head>
					<Table.Head>Qty</Table.Head>
					<Table.Head>Unit</Table.Head>
					<Table.Head>Tax %</Table.Head>
					{#if !readonly}
						<Table.Head class="w-16"></Table.Head>
					{/if}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as row (row.id)}
					<Table.Row>
						<Table.Cell>
							<div class="max-w-xs truncate" title={row.descriptionTemplate}>
								{row.descriptionTemplate}
							</div>
							{#if row.productSku}
								<div class="text-muted-foreground text-xs">{row.productSku}</div>
							{/if}
						</Table.Cell>
						<Table.Cell>{row.qty}</Table.Cell>
						<Table.Cell>{row.unitPrice}</Table.Cell>
						<Table.Cell>{row.taxRatePercent || '0'}</Table.Cell>
						{#if !readonly}
							<Table.Cell>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onclick={() => onRemove?.(row.id)}
								>
									Remove
								</Button>
							</Table.Cell>
						{/if}
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
