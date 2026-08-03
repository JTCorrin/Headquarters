<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { BillFormData } from '$lib/schemas/bill.js';
	import type { BillVendorOption } from '$lib/schemas/bill.js';
	import VendorPicker from './vendor-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import DateField from './date-field.svelte';
	import { cn } from '$lib/utils.js';

	export interface BillFormProps {
		form: SuperForm<BillFormData>;
		submitLabel?: string;
		vendorOptions?: BillVendorOption[];
		/** Draft fields are editable; received bills are read-only. */
		readonly?: boolean;
		/** Hide status selector (create drawer). */
		hideStatus?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onCreateVendor?: () => void;
	}

	let {
		form,
		submitLabel = 'Save bill',
		vendorOptions = [],
		readonly = false,
		hideStatus = false,
		class: className,
		onValidSubmit,
		onCreateVendor
	}: BillFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const currencyOptions = [
		{ value: 'GBP', label: 'GBP' },
		{ value: 'USD', label: 'USD' },
		{ value: 'EUR', label: 'EUR' }
	] as const;
	const statusOptions = [
		{ value: 'draft', label: 'Draft' },
		{ value: 'received', label: 'Received' },
		{ value: 'scheduled', label: 'Scheduled' },
		{ value: 'partial', label: 'Partial' },
		{ value: 'paid', label: 'Paid' },
		{ value: 'void', label: 'Void' }
	] as const;

	const currencyLabel = $derived(
		currencyOptions.find((o) => o.value === $formData.currency)?.label ?? 'Currency'
	);
	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
	/** Live pages pass onCreateVendor — keep picker even with zero vendors so bootstrap works. */
	const useVendorPicker = $derived(Boolean(onCreateVendor) || vendorOptions.length > 0);

	$effect(() => {
		const selected = vendorOptions.find((o) => o.id === $formData.vendorId);
		if (selected && $formData.vendorName !== selected.name) {
			$formData.vendorName = selected.name;
		}
		if (selected?.defaultCurrency && !$formData.currency) {
			const c = selected.defaultCurrency;
			if (c === 'GBP' || c === 'USD' || c === 'EUR') {
				$formData.currency = c;
			}
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
	data-testid="bill-form"
>
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="bill-vendor">Vendor</Label>
			{#if useVendorPicker}
				<VendorPicker
					id="bill-vendor"
					value={$formData.vendorId}
					options={vendorOptions}
					disabled={readonly}
					aria-invalid={!!$errors.vendorId}
					onValueChange={(id) => {
						$formData.vendorId = id;
					}}
					onCreateNew={onCreateVendor}
				/>
			{:else}
				<Input
					id="bill-vendor"
					name="vendorName"
					bind:value={$formData.vendorName}
					placeholder="Cloudflare"
					aria-invalid={!!$errors.vendorId || !!$errors.vendorName}
					disabled={readonly}
				/>
			{/if}
			{#if $errors.vendorId}<p class="text-destructive text-xs">{$errors.vendorId}</p>{/if}
			{#if $errors.vendorName}<p class="text-destructive text-xs">{$errors.vendorName}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="bill-number">Vendor bill number</Label>
			<Input
				id="bill-number"
				name="number"
				bind:value={$formData.number}
				placeholder="BILL-0142"
				aria-invalid={!!$errors.number}
				disabled={readonly}
			/>
			{#if $errors.number}<p class="text-destructive text-xs">{$errors.number}</p>{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="bill-currency">Currency</Label>
			<Select.Root
				type="single"
				bind:value={$formData.currency}
				name="currency"
				disabled={readonly}
			>
				<Select.Trigger id="bill-currency" class="w-full">{currencyLabel}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		{#if !hideStatus}
			<div class="space-y-2">
				<Label for="bill-status">Status</Label>
				<Select.Root
					type="single"
					bind:value={$formData.status}
					name="status"
					disabled={readonly}
				>
					<Select.Trigger id="bill-status" class="w-full">{statusLabel}</Select.Trigger>
					<Select.Content>
						{#each statusOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
	</div>

	<div class="space-y-2">
		<Label for="bill-internal-ref">Internal reference</Label>
		<Input
			id="bill-internal-ref"
			name="internalReference"
			bind:value={$formData.internalReference}
			placeholder="Optional"
			disabled={readonly}
		/>
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="space-y-2">
			<Label for="bill-issue">Issue on</Label>
			<DateField
				id="bill-issue"
				name="issueOn"
				bind:value={$formData.issueOn}
				disabled={readonly}
				readonly={readonly}
			/>
		</div>
		<div class="space-y-2">
			<Label for="bill-received">Received on</Label>
			<DateField
				id="bill-received"
				name="receivedOn"
				bind:value={$formData.receivedOn}
				disabled={readonly}
				readonly={readonly}
			/>
			{#if $errors.receivedOn}<p class="text-destructive text-xs">{$errors.receivedOn}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="bill-due">Due on</Label>
			<DateField
				id="bill-due"
				name="dueOn"
				bind:value={$formData.dueOn}
				disabled={readonly}
				readonly={readonly}
			/>
			{#if $errors.dueOn}<p class="text-destructive text-xs">{$errors.dueOn}</p>{/if}
		</div>
	</div>

	<div class="space-y-2">
		<Label for="bill-notes">Notes</Label>
		<Textarea id="bill-notes" name="notes" bind:value={$formData.notes} rows={2} disabled={readonly} />
	</div>

	{#if !readonly}
		<Button type="submit" disabled={busy}>{submitLabel}</Button>
	{/if}
</form>
