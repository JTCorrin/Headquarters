<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		PaymentBillOption,
		PaymentClientOption,
		PaymentFormData,
		PaymentInvoiceOption,
		PaymentListItem,
		PaymentVendorOption
	} from '$lib/schemas/payment.js';
	import PaymentFormDrawer from './payment-form-drawer.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface DocumentPaymentsPanelProps {
		title?: string;
		paidLabel: string;
		balanceLabel: string;
		status: string;
		rows: PaymentListItem[];
		form: SuperForm<PaymentFormData>;
		clientOptions?: PaymentClientOption[];
		vendorOptions?: PaymentVendorOption[];
		invoiceOptions?: PaymentInvoiceOption[];
		billOptions?: PaymentBillOption[];
		drawerOpen?: boolean;
		actionPending?: boolean;
		canRecord?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onReverse?: (paymentId: string) => void | Promise<void>;
	}

	let {
		title = 'Payments',
		paidLabel,
		balanceLabel,
		status,
		rows,
		form,
		clientOptions = [],
		vendorOptions = [],
		invoiceOptions = [],
		billOptions = [],
		drawerOpen = $bindable(false),
		actionPending = false,
		canRecord = true,
		class: className,
		onValidSubmit,
		onReverse
	}: DocumentPaymentsPanelProps = $props();
</script>

<section
	class={cn(
		'bg-card self-start space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
	data-testid="document-payments-panel"
>
	<div class="flex items-start justify-between gap-3">
		<div class="space-y-1">
			<h2 class="text-sm font-semibold tracking-tight">{title}</h2>
			<p class="text-muted-foreground text-xs">
				Paid {paidLabel} · Balance {balanceLabel}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<StatusBadge {status} />
			{#if canRecord}
				<PaymentFormDrawer
					bind:open={drawerOpen}
					{form}
					{clientOptions}
					{vendorOptions}
					{invoiceOptions}
					{billOptions}
					lockDirection
					title="Record payment"
					description="Allocate this payment to the current document."
					submitLabel="Record payment"
					triggerLabel="Record payment"
					{onValidSubmit}
				/>
			{/if}
		</div>
	</div>

	{#if rows.length === 0}
		<p class="text-muted-foreground text-sm">No linked payments yet.</p>
	{:else}
		<ul class="divide-y divide-foreground/10">
			{#each rows as row (row.id)}
				<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
					<div class="min-w-0 space-y-0.5">
						<p class="font-medium">{row.amount} · {row.method}</p>
						<p class="text-muted-foreground text-xs">
							{row.occurredOn} · {row.status} · {row.allocationsSummary}
						</p>
					</div>
					{#if onReverse && row.statusKey !== 'reversed' && row.statusKey !== 'failed'}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onReverse(row.id)}
						>
							Reverse
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
