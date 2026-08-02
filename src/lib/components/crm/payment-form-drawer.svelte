<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		PaymentBillOption,
		PaymentClientOption,
		PaymentFormData,
		PaymentInvoiceOption,
		PaymentVendorOption
	} from '$lib/schemas/payment.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PaymentForm from './payment-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface PaymentFormDrawerProps {
		form: SuperForm<PaymentFormData>;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		clientOptions?: PaymentClientOption[];
		vendorOptions?: PaymentVendorOption[];
		invoiceOptions?: PaymentInvoiceOption[];
		billOptions?: PaymentBillOption[];
		lockDirection?: boolean;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		open = $bindable(false),
		title = 'Record payment',
		description = 'Ledger entry for money in or out — allocate to an invoice or bill, or leave unallocated.',
		submitLabel = 'Save payment',
		triggerLabel = 'Record payment',
		clientOptions = [],
		vendorOptions = [],
		invoiceOptions = [],
		billOptions = [],
		lockDirection = false,
		class: className,
		trigger,
		onValidSubmit
	}: PaymentFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if trigger}
		<Drawer.Trigger>
			{@render trigger()}
		</Drawer.Trigger>
	{:else}
		<Drawer.Trigger>
			{#snippet child({ props })}
				<Button type="button" size="sm" {...props}>{triggerLabel}</Button>
			{/snippet}
		</Drawer.Trigger>
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<PaymentForm
				{form}
				{clientOptions}
				{vendorOptions}
				{invoiceOptions}
				{billOptions}
				{lockDirection}
				{submitLabel}
				{onValidSubmit}
			/>
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
