<script lang="ts">
	import {
		formatRecurringRunStatus,
		type RecurringInvoiceRunListItem
	} from '$lib/schemas/recurring-invoice.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';

	export interface RecurringInvoiceRunsTableProps {
		rows?: RecurringInvoiceRunListItem[];
		class?: string;
		onRetryDelivery?: (runId: string) => void | Promise<void>;
	}

	let {
		rows = [],
		class: className,
		onRetryDelivery
	}: RecurringInvoiceRunsTableProps = $props();
</script>

<div
	class={cn(
		'bg-card overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="border-b px-4 py-3">
		<h3 class="text-sm font-medium">Run history</h3>
		<p class="text-muted-foreground text-xs">
			Scheduled and manual generation attempts, including email delivery status.
		</p>
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
					<Table.Head class="w-[1%]"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as row (row.id)}
					<Table.Row>
						<Table.Cell>{row.scheduledFor}</Table.Cell>
						<Table.Cell class="capitalize">{row.trigger}</Table.Cell>
						<Table.Cell>{row.periodStart} → {row.periodEnd}</Table.Cell>
						<Table.Cell>
							<span class="capitalize">{formatRecurringRunStatus(row.status)}</span>
							{#if row.errorMessage && row.status === 'delivery_failed'}
								<p class="text-destructive mt-1 max-w-xs text-xs">{row.errorMessage}</p>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{#if row.invoiceId}
								<a href="/invoices/{row.invoiceId}" class="hover:underline">
									{row.invoiceNumber ?? 'View invoice'}
								</a>
							{:else}
								<span class="text-muted-foreground">—</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{#if onRetryDelivery && (row.status === 'delivery_failed' || row.status === 'delivery_unknown')}
								<Button
									variant="outline"
									size="sm"
									onclick={() => onRetryDelivery(row.id)}
									data-testid={`ri-retry-delivery-${row.id}`}
								>
									Retry delivery
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>
