<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { QuoteFormData } from '$lib/schemas/quote.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface QuoteFormProps {
		form: SuperForm<QuoteFormData>;
		submitLabel?: string;
		class?: string;
	}

	let { form, submitLabel = 'Save quote', class: className }: QuoteFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	const currencyOptions = [
		{ value: 'GBP', label: 'GBP' },
		{ value: 'USD', label: 'USD' },
		{ value: 'EUR', label: 'EUR' }
	] as const;
	const statusOptions = [
		{ value: 'draft', label: 'Draft' },
		{ value: 'sent', label: 'Sent' },
		{ value: 'accepted', label: 'Accepted' },
		{ value: 'rejected', label: 'Rejected' }
	] as const;

	const currencyLabel = $derived(
		currencyOptions.find((o) => o.value === $formData.currency)?.label ?? 'Currency'
	);
	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
</script>

<form method="POST" use:enhance class={cn('space-y-4', className)}>
	<div class="space-y-2">
		<Label for="quote-client">Client</Label>
		<Input
			id="quote-client"
			name="clientName"
			bind:value={$formData.clientName}
			placeholder="Northwind"
			aria-invalid={!!$errors.clientName}
		/>
		{#if $errors.clientName}<p class="text-destructive text-xs">{$errors.clientName}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="quote-title">Title</Label>
		<Input
			id="quote-title"
			name="title"
			bind:value={$formData.title}
			placeholder="Q2 retainer"
			aria-invalid={!!$errors.title}
		/>
		{#if $errors.title}<p class="text-destructive text-xs">{$errors.title}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="quote-currency">Currency</Label>
			<Select.Root type="single" bind:value={$formData.currency} name="currency">
				<Select.Trigger id="quote-currency" class="w-full">{currencyLabel}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="quote-status">Status</Label>
			<Select.Root type="single" bind:value={$formData.status} name="status">
				<Select.Trigger id="quote-status" class="w-full">{statusLabel}</Select.Trigger>
				<Select.Content>
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="space-y-2">
		<Label for="quote-line">Line item</Label>
		<Input
			id="quote-line"
			name="lineDescription"
			bind:value={$formData.lineDescription}
			placeholder="Monthly retainer"
			aria-invalid={!!$errors.lineDescription}
		/>
		{#if $errors.lineDescription}<p class="text-destructive text-xs">{$errors.lineDescription}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="quote-qty">Qty</Label>
			<Input id="quote-qty" name="qty" bind:value={$formData.qty} placeholder="1" />
			{#if $errors.qty}<p class="text-destructive text-xs">{$errors.qty}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="quote-unit">Unit price</Label>
			<Input
				id="quote-unit"
				name="unitPrice"
				bind:value={$formData.unitPrice}
				placeholder="4200.00"
			/>
			{#if $errors.unitPrice}<p class="text-destructive text-xs">{$errors.unitPrice}</p>{/if}
		</div>
	</div>

	<Button type="submit" disabled={$submitting}>{submitLabel}</Button>
</form>
