<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { PaymentFormData } from '$lib/schemas/payment.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface PaymentFormProps {
		form: SuperForm<PaymentFormData>;
		submitLabel?: string;
		class?: string;
	}

	let { form, submitLabel = 'Save payment', class: className }: PaymentFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	const currencyOptions = [
		{ value: 'GBP', label: 'GBP' },
		{ value: 'USD', label: 'USD' },
		{ value: 'EUR', label: 'EUR' }
	] as const;
	const methodOptions = [
		{ value: 'bank', label: 'Bank transfer' },
		{ value: 'card', label: 'Card' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'other', label: 'Other' }
	] as const;
	const statusOptions = [
		{ value: 'pending', label: 'Pending' },
		{ value: 'matched', label: 'Matched' },
		{ value: 'unallocated', label: 'Unallocated' },
		{ value: 'refunded', label: 'Refunded' }
	] as const;

	const currencyLabel = $derived(
		currencyOptions.find((o) => o.value === $formData.currency)?.label ?? 'Currency'
	);
	const methodLabel = $derived(
		methodOptions.find((o) => o.value === $formData.method)?.label ?? 'Method'
	);
	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
</script>

<form method="POST" use:enhance class={cn('space-y-4', className)}>
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="payment-client">Client</Label>
			<Input
				id="payment-client"
				name="clientName"
				bind:value={$formData.clientName}
				placeholder="Northwind"
				aria-invalid={!!$errors.clientName}
			/>
			{#if $errors.clientName}<p class="text-destructive text-xs">{$errors.clientName}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="payment-invoice">Invoice #</Label>
			<Input
				id="payment-invoice"
				name="invoiceNumber"
				bind:value={$formData.invoiceNumber}
				placeholder="INV-0881 (optional)"
			/>
		</div>
	</div>

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
			<Label for="payment-status">Status</Label>
			<Select.Root type="single" bind:value={$formData.status} name="status">
				<Select.Trigger id="payment-status" class="w-full">{statusLabel}</Select.Trigger>
				<Select.Content>
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="payment-received">Received on</Label>
			<Input
				id="payment-received"
				name="receivedOn"
				type="date"
				bind:value={$formData.receivedOn}
			/>
			{#if $errors.receivedOn}<p class="text-destructive text-xs">{$errors.receivedOn}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="payment-ref">Reference</Label>
			<Input
				id="payment-ref"
				name="reference"
				bind:value={$formData.reference}
				placeholder="Stripe pi_…"
			/>
		</div>
	</div>

	<Button type="submit" disabled={$submitting}>{submitLabel}</Button>
</form>
