<script lang="ts">
	import type { RecurringInvoiceRunListItem } from '$lib/schemas/recurring-invoice.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';

	export interface RecurringInvoiceRunsTableProps {
		rows: RecurringInvoiceRunListItem[];
		class?: string;
	}

	let { rows = [], class: className }: RecurringInvoiceRunsTableProps = $props();
</script>

<div
	class={cn(
		'bg-card overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="border-b px-4 py-3">
		<h3 class="text-sm font-medium">Run history</h3>
		<p class="text-muted-foreground text-xs">Scheduled and manual generation attempts.</p>
	</div>
	{#if rows.length === 0}
		<p class="text-muted-foreground px-4 py-8 text-center text-sm">No runs yet.</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Scheduled</Table.Head>
					<Table.Head>Trigger</Table.Head>
					<Table.Head>Period</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head>Invoice</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as row (row.id)}
					<Table.Row>
						<Table.Cell>{row.scheduledFor}</Table.Cell>
						<Table.Cell class="capitalize">{row.trigger}</Table.Cell>
						<Table.Cell>{row.periodStart} → {row.periodEnd}</Table.Cell>
						<Table.Cell class="capitalize">{row.status}</Table.Cell>
						<Table.Cell>
							{#if row.invoiceId}
								<a href="/invoices/{row.invoiceId}" class="hover:underline">
									{row.invoiceNumber ?? 'View invoice'}
								</a>
							{:else}
								<span class="text-muted-foreground">—</span>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
