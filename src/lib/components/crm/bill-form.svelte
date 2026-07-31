<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { BillFormData } from '$lib/schemas/bill.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface BillFormProps {
		form: SuperForm<BillFormData>;
		submitLabel?: string;
		class?: string;
	}

	let { form, submitLabel = 'Save bill', class: className }: BillFormProps = $props();

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
		{ value: 'received', label: 'Received' },
		{ value: 'scheduled', label: 'Scheduled' },
		{ value: 'paid', label: 'Paid' },
		{ value: 'void', label: 'Void' }
	] as const;

	const currencyLabel = $derived(
		currencyOptions.find((o) => o.value === $formData.currency)?.label ?? 'Currency'
	);
	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
</script>

<form method="POST" use:enhance class={cn('space-y-4', className)}>
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="bill-vendor">Vendor</Label>
			<Input
				id="bill-vendor"
				name="vendorName"
				bind:value={$formData.vendorName}
				placeholder="Cloudflare"
				aria-invalid={!!$errors.vendorName}
			/>
			{#if $errors.vendorName}<p class="text-destructive text-xs">{$errors.vendorName}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="bill-number">Number</Label>
			<Input
				id="bill-number"
				name="number"
				bind:value={$formData.number}
				placeholder="BILL-0142"
				aria-invalid={!!$errors.number}
			/>
			{#if $errors.number}<p class="text-destructive text-xs">{$errors.number}</p>{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="bill-currency">Currency</Label>
			<Select.Root type="single" bind:value={$formData.currency} name="currency">
				<Select.Trigger id="bill-currency" class="w-full">{currencyLabel}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="bill-status">Status</Label>
			<Select.Root type="single" bind:value={$formData.status} name="status">
				<Select.Trigger id="bill-status" class="w-full">{statusLabel}</Select.Trigger>
				<Select.Content>
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="space-y-2">
		<Label for="bill-due">Due on</Label>
		<Input id="bill-due" name="dueOn" type="date" bind:value={$formData.dueOn} />
		{#if $errors.dueOn}<p class="text-destructive text-xs">{$errors.dueOn}</p>{/if}
	</div>

	<Button type="submit" disabled={$submitting}>{submitLabel}</Button>
</form>
