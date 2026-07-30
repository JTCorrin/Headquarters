<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import StatusBadge from './status-badge.svelte';
	import { cn } from '$lib/utils.js';

	export interface ProductRow {
		id: string;
		sku: string;
		name: string;
		unitPrice: string;
		stock?: number;
		status: string;
	}

	export interface ProductsTableProps {
		rows: ProductRow[];
		class?: string;
	}

	let { rows, class: className }: ProductsTableProps = $props();
</script>

<div
	class={cn(
		'overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>SKU</Table.Head>
				<Table.Head>Name</Table.Head>
				<Table.Head class="text-right">Unit price</Table.Head>
				<Table.Head class="text-right">Stock</Table.Head>
				<Table.Head>Status</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.id)}
				<Table.Row>
					<Table.Cell class="font-mono text-xs">{row.sku}</Table.Cell>
					<Table.Cell class="font-medium">{row.name}</Table.Cell>
					<Table.Cell class="text-right tabular-nums">{row.unitPrice}</Table.Cell>
					<Table.Cell class="text-muted-foreground text-right tabular-nums">
						{row.stock ?? '—'}
					</Table.Cell>
					<Table.Cell><StatusBadge status={row.status} /></Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={5} class="text-muted-foreground py-10 text-center">
						No products yet.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
