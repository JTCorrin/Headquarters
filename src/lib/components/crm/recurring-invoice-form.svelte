<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		RecurringInvoiceClientOption,
		RecurringInvoiceContactOption,
		RecurringInvoiceFormData
	} from '$lib/schemas/recurring-invoice.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import DateField from './date-field.svelte';
	import DateRangeField from './date-range-field.svelte';
	import DocumentRecipientsField from './document-recipients-field.svelte';
	import { cn } from '$lib/utils.js';

	export interface RecurringInvoiceFormProps {
		form: SuperForm<RecurringInvoiceFormData>;
		submitLabel?: string;
		clientOptions?: RecurringInvoiceClientOption[];
		contactOptions?: RecurringInvoiceContactOption[];
		readonly?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save schedule',
		clientOptions = [],
		contactOptions = [],
		readonly = false,
		class: className,
		onValidSubmit
	}: RecurringInvoiceFormProps = $props();

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

	const frequencyOptions = [
		{ value: 'daily', label: 'Daily' },
		{ value: 'weekly', label: 'Weekly' },
		{ value: 'monthly', label: 'Monthly' },
		{ value: 'yearly', label: 'Yearly' }
	] as const;

	const weekdayOptions = [
		{ value: '1', label: 'Monday' },
		{ value: '2', label: 'Tuesday' },
		{ value: '3', label: 'Wednesday' },
		{ value: '4', label: 'Thursday' },
		{ value: '5', label: 'Friday' },
		{ value: '6', label: 'Saturday' },
		{ value: '7', label: 'Sunday' }
	] as const;

	const monthOptions = Array.from({ length: 12 }, (_, i) => ({
		value: String(i + 1),
		label: new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })
	}));

	const clientLabel = $derived(
		clientOptions.find((o) => o.id === $formData.clientId)?.name ??
			($formData.clientName || 'Select client')
	);

	$effect(() => {
		const selected = clientOptions.find((o) => o.id === $formData.clientId);
		if (selected && $formData.clientName !== selected.name) {
			$formData.clientName = selected.name;
		}
	});

	$effect(() => {
		const client = $formData.clientId;
		const next = $formData.recipients.filter((row) => {
			const match = contactOptions.find((c) => c.id === row.contactId);
			if (!match) return true;
			if (match.clientId && client && match.clientId !== client) return false;
			return true;
		});
		if (next.length !== $formData.recipients.length) {
			if (next.length > 0 && !next.some((r) => r.isBilling)) {
				next[0] = { ...next[0], isBilling: true };
			}
			$formData.recipients = next;
		}
	});
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="recurring-invoice-form"
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
>
	<div class="space-y-2">
		<Label for="ri-name">Schedule name</Label>
		<Input
			id="ri-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Northwind monthly retainer"
			disabled={readonly}
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="ri-client">Client</Label>
		{#if clientOptions.length > 0}
			<Select.Root
				type="single"
				value={$formData.clientId}
				onValueChange={(value) => {
					if (value) $formData.clientId = value;
				}}
				disabled={readonly}
				name="clientId"
			>
				<Select.Trigger id="ri-client" class="w-full">{clientLabel}</Select.Trigger>
				<Select.Content>
					{#each clientOptions as client (client.id)}
						<Select.Item value={client.id} label={client.name}>{client.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{:else}
			<Input id="ri-client" bind:value={$formData.clientName} disabled={readonly} />
		{/if}
		{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
	</div>

	<DocumentRecipientsField
		recipients={$formData.recipients}
		{contactOptions}
		clientId={$formData.clientId}
		disabled={readonly}
		onRecipientsChange={(next) => {
			$formData.recipients = next;
		}}
	/>
	{#if $errors.recipients}
		<p class="text-destructive text-xs">{$errors.recipients}</p>
	{/if}

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="ri-currency">Currency</Label>
			<Select.Root
				type="single"
				value={$formData.currency}
				onValueChange={(value) => {
					if (value === 'GBP' || value === 'USD' || value === 'EUR') $formData.currency = value;
				}}
				disabled={readonly}
			>
				<Select.Trigger id="ri-currency" class="w-full">{$formData.currency}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="ri-due-days">Due days after issue</Label>
			<Input
				id="ri-due-days"
				type="number"
				min="0"
				bind:value={$formData.dueDays}
				disabled={readonly}
			/>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="ri-frequency">Frequency</Label>
			<Select.Root
				type="single"
				value={$formData.frequency}
				onValueChange={(value) => {
					if (
						value === 'daily' ||
						value === 'weekly' ||
						value === 'monthly' ||
						value === 'yearly'
					) {
						$formData.frequency = value;
					}
				}}
				disabled={readonly}
			>
				<Select.Trigger id="ri-frequency" class="w-full capitalize"
					>{$formData.frequency}</Select.Trigger
				>
				<Select.Content>
					{#each frequencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="ri-interval">Every (interval)</Label>
			<Input
				id="ri-interval"
				type="number"
				min="1"
				bind:value={$formData.intervalCount}
				disabled={readonly}
			/>
		</div>
	</div>

	{#if $formData.frequency === 'weekly'}
		<div class="space-y-2">
			<Label for="ri-weekday">Weekday</Label>
			<Select.Root
				type="single"
				value={$formData.weekday || '1'}
				onValueChange={(value) => {
					if (value) $formData.weekday = value;
				}}
				disabled={readonly}
			>
				<Select.Trigger id="ri-weekday" class="w-full">
					{weekdayOptions.find((o) => o.value === ($formData.weekday || '1'))?.label ?? 'Monday'}
				</Select.Trigger>
				<Select.Content>
					{#each weekdayOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	{#if $formData.frequency === 'monthly' || $formData.frequency === 'yearly'}
		<div class="grid gap-4 sm:grid-cols-2">
			{#if $formData.frequency === 'yearly'}
				<div class="space-y-2">
					<Label for="ri-month">Month</Label>
					<Select.Root
						type="single"
						value={String($formData.monthOfYear ?? 1)}
						onValueChange={(value) => {
							if (value) $formData.monthOfYear = Number(value);
						}}
						disabled={readonly}
					>
						<Select.Trigger id="ri-month" class="w-full">
							{monthOptions.find((o) => o.value === String($formData.monthOfYear ?? 1))?.label ??
								'January'}
						</Select.Trigger>
						<Select.Content>
							{#each monthOptions as option (option.value)}
								<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
			<div class="space-y-2">
				<Label for="ri-dom">Day of month</Label>
				<Input
					id="ri-dom"
					type="number"
					min="1"
					max="31"
					bind:value={$formData.dayOfMonth}
					disabled={readonly}
				/>
			</div>
		</div>
	{/if}

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="ri-timezone">Timezone</Label>
			<Input id="ri-timezone" bind:value={$formData.timezone} disabled={readonly} />
		</div>
		<div class="space-y-2">
			<Label for="ri-local-time">Local run time</Label>
			<Input id="ri-local-time" bind:value={$formData.localRunTime} disabled={readonly} />
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="space-y-2">
			<Label for="ri-anchor">Anchor date</Label>
			<DateField
				id="ri-anchor"
				name="anchorOn"
				bind:value={$formData.anchorOn}
				disabled={readonly}
				readonly={readonly}
			/>
		</div>
		<DateRangeField
			class="sm:col-span-2"
			startId="ri-start"
			endId="ri-end"
			startName="startOn"
			endName="endOn"
			bind:startValue={$formData.startOn}
			bind:endValue={$formData.endOn}
			disabled={readonly}
			readonly={readonly}
			data-testid="ri-date-range"
		/>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="ri-delivery">Delivery mode</Label>
			<Select.Root
				type="single"
				value={$formData.deliveryMode}
				onValueChange={(value) => {
					if (value === 'draft' || value === 'auto_send') $formData.deliveryMode = value;
				}}
				disabled={readonly}
			>
				<Select.Trigger id="ri-delivery" class="w-full">
					{$formData.deliveryMode === 'auto_send' ? 'Auto-send' : 'Save as draft'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="draft" label="Save as draft">Save as draft</Select.Item>
					<Select.Item value="auto_send" label="Auto-send (stored only)">Auto-send (stored only)</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="ri-month-end">Month-end policy</Label>
			<Select.Root
				type="single"
				value={$formData.monthEndPolicy}
				onValueChange={(value) => {
					if (value === 'clamp' || value === 'last_day' || value === 'skip') {
						$formData.monthEndPolicy = value;
					}
				}}
				disabled={readonly}
			>
				<Select.Trigger id="ri-month-end" class="w-full capitalize"
					>{$formData.monthEndPolicy.replace('_', ' ')}</Select.Trigger
				>
				<Select.Content>
					<Select.Item value="clamp" label="Clamp to last day">Clamp to last day</Select.Item>
					<Select.Item value="last_day" label="Last day of month">Last day of month</Select.Item>
					<Select.Item value="skip" label="Skip month">Skip month</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="space-y-2">
		<Label for="ri-notes">Customer notes</Label>
		<Textarea id="ri-notes" bind:value={$formData.notes} rows={2} disabled={readonly} />
	</div>

	{#if !readonly}
		<Button type="submit" disabled={busy}>{submitLabel}</Button>
	{/if}
</form>
