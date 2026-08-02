<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		PaymentBillOption,
		PaymentClientOption,
		PaymentFormData,
		PaymentInvoiceOption,
		PaymentVendorOption
	} from '$lib/schemas/payment.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface PaymentFormProps {
		form: SuperForm<PaymentFormData>;
		clientOptions?: PaymentClientOption[];
		vendorOptions?: PaymentVendorOption[];
		invoiceOptions?: PaymentInvoiceOption[];
		billOptions?: PaymentBillOption[];
		/** Lock direction when recording from invoice/bill detail. */
		lockDirection?: boolean;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		clientOptions = [],
		vendorOptions = [],
		invoiceOptions = [],
		billOptions = [],
		lockDirection = false,
		submitLabel = 'Save payment',
		class: className,
		onValidSubmit
	}: PaymentFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const directionOptions = [
		{ value: 'inbound', label: 'Inbound (from client)' },
		{ value: 'outbound', label: 'Outbound (to vendor)' }
	] as const;
	const currencyOptions = [
		{ value: 'GBP', label: 'GBP' },
		{ value: 'USD', label: 'USD' },
		{ value: 'EUR', label: 'EUR' }
	] as const;
	const methodOptions = [
		{ value: 'bank', label: 'Bank transfer' },
		{ value: 'card', label: 'Card' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'stripe', label: 'Stripe' },
		{ value: 'other', label: 'Other' }
	] as const;

	const directionLabel = $derived(
		directionOptions.find((o) => o.value === $formData.direction)?.label ?? 'Direction'
	);
	const currencyLabel = $derived(
		currencyOptions.find((o) => o.value === $formData.currency)?.label ?? 'Currency'
	);
	const methodLabel = $derived(
		methodOptions.find((o) => o.value === $formData.method)?.label ?? 'Method'
	);
	const clientLabel = $derived(
		clientOptions.find((o) => o.id === $formData.clientId)?.name ??
			($formData.clientName || 'Select client')
	);
	const vendorLabel = $derived(
		vendorOptions.find((o) => o.id === $formData.vendorId)?.name ??
			($formData.vendorName || 'Select vendor')
	);

	const invoicesForClient = $derived(
		invoiceOptions.filter(
			(inv) =>
				(!$formData.clientId || inv.clientId === $formData.clientId) &&
				['sent', 'partial', 'paid'].includes(inv.status) &&
				(!$formData.currency || inv.currency === $formData.currency)
		)
	);
	const billsForVendor = $derived(
		billOptions.filter(
			(bill) =>
				(!$formData.vendorId || bill.vendorId === $formData.vendorId) &&
				['received', 'partial', 'paid'].includes(bill.status) &&
				(!$formData.currency || bill.currency === $formData.currency)
		)
	);

	const invoiceLabel = $derived(
		invoicesForClient.find((o) => o.id === $formData.invoiceId)?.number ?? 'Optional invoice'
	);
	const billLabel = $derived(
		billsForVendor.find((o) => o.id === $formData.billId)?.number ?? 'Optional bill'
	);

	$effect(() => {
		const selected = clientOptions.find((o) => o.id === $formData.clientId);
		if (selected && $formData.clientName !== selected.name) {
			$formData.clientName = selected.name;
		}
	});

	$effect(() => {
		const selected = vendorOptions.find((o) => o.id === $formData.vendorId);
		if (selected && $formData.vendorName !== selected.name) {
			$formData.vendorName = selected.name;
		}
	});

	$effect(() => {
		if ($formData.direction === 'inbound' && $formData.billId) {
			$formData.billId = '';
		}
		if ($formData.direction === 'outbound' && $formData.invoiceId) {
			$formData.invoiceId = '';
		}
	});
</script>

<form
	method="POST"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			if (submitLock) return false;
			submitLock = true;
			pendingSubmit = true;
			try {
				return await onValidSubmit?.();
			} catch {
				return false;
			} finally {
				submitLock = false;
				pendingSubmit = false;
			}
		}
	}}
	class={cn('space-y-4', className)}
	data-testid="payment-form"
>
	<div class="space-y-2">
		<Label for="payment-direction">Direction</Label>
		<Select.Root
			type="single"
			bind:value={$formData.direction}
			name="direction"
			disabled={lockDirection}
		>
			<Select.Trigger id="payment-direction" class="w-full">{directionLabel}</Select.Trigger>
			<Select.Content>
				{#each directionOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if $formData.direction === 'inbound'}
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="payment-client">Client</Label>
				<Select.Root type="single" bind:value={$formData.clientId} name="clientId">
					<Select.Trigger id="payment-client" class="w-full">{clientLabel}</Select.Trigger>
					<Select.Content>
						{#each clientOptions as option (option.id)}
							<Select.Item value={option.id} label={option.name}>{option.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="payment-invoice">Invoice</Label>
				<Select.Root type="single" bind:value={$formData.invoiceId} name="invoiceId">
					<Select.Trigger id="payment-invoice" class="w-full">{invoiceLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="" label="None (unallocated)">None (unallocated)</Select.Item>
						{#each invoicesForClient as option (option.id)}
							<Select.Item value={option.id} label={option.number}>{option.number}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="payment-vendor">Vendor</Label>
				<Select.Root type="single" bind:value={$formData.vendorId} name="vendorId">
					<Select.Trigger id="payment-vendor" class="w-full">{vendorLabel}</Select.Trigger>
					<Select.Content>
						{#each vendorOptions as option (option.id)}
							<Select.Item value={option.id} label={option.name}>{option.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if $errors.vendorId}<p class="text-destructive text-xs">{$errors.vendorId}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="payment-bill">Bill</Label>
				<Select.Root type="single" bind:value={$formData.billId} name="billId">
					<Select.Trigger id="payment-bill" class="w-full">{billLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="" label="None (unallocated)">None (unallocated)</Select.Item>
						{#each billsForVendor as option (option.id)}
							<Select.Item value={option.id} label={option.number}>{option.number}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	{/if}

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="payment-amount">Amount</Label>
			<Input
				id="payment-amount"
				name="amount"
				bind:value={$formData.amount}
				placeholder="4200.00"
				aria-invalid={!!$errors.amount}
			/>
			{#if $errors.amount}<p class="text-destructive text-xs">{$errors.amount}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="payment-currency">Currency</Label>
			<Select.Root type="single" bind:value={$formData.currency} name="currency">
				<Select.Trigger id="payment-currency" class="w-full">{currencyLabel}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="payment-method">Method</Label>
			<Select.Root type="single" bind:value={$formData.method} name="method">
				<Select.Trigger id="payment-method" class="w-full">{methodLabel}</Select.Trigger>
				<Select.Content>
					{#each methodOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="payment-occurred">{$formData.direction === 'inbound' ? 'Received on' : 'Paid on'}</Label>
			<Input
				id="payment-occurred"
				name="occurredOn"
				type="date"
				bind:value={$formData.occurredOn}
			/>
			{#if $errors.occurredOn}<p class="text-destructive text-xs">{$errors.occurredOn}</p>{/if}
		</div>
	</div>

	<div class="space-y-2">
		<Label for="payment-ref">Reference</Label>
		<Input
			id="payment-ref"
			name="reference"
			bind:value={$formData.reference}
			placeholder="Bank ref / cheque #"
		/>
	</div>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
