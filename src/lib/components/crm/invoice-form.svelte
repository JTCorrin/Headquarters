<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		InvoiceClientOption,
		InvoiceContactOption,
		InvoiceFormData,
		InvoiceQuoteOption
	} from '$lib/schemas/invoice.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import DateField from './date-field.svelte';
	import { cn } from '$lib/utils.js';

	export interface InvoiceFormProps {
		form: SuperForm<InvoiceFormData>;
		submitLabel?: string;
		clientOptions?: InvoiceClientOption[];
		contactOptions?: InvoiceContactOption[];
		quoteOptions?: InvoiceQuoteOption[];
		/** When true, show accepted-quote convert selector (create drawer). */
		showQuotePrefill?: boolean;
		/** Draft fields are editable; issued invoices are read-only. */
		readonly?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save invoice',
		clientOptions = [],
		contactOptions = [],
		quoteOptions = [],
		showQuotePrefill = false,
		readonly = false,
		class: className,
		onValidSubmit
	}: InvoiceFormProps = $props();

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

	const currencyLabel = $derived(
		currencyOptions.find((o) => o.value === $formData.currency)?.label ?? 'Currency'
	);
	const clientLabel = $derived(
		clientOptions.find((o) => o.id === $formData.clientId)?.name ??
			($formData.clientName || 'Select client')
	);
	const useClientSelect = $derived(clientOptions.length > 0);
	const contactsForClient = $derived(
		contactOptions.filter(
			(c) => !c.clientId || !$formData.clientId || c.clientId === $formData.clientId
		)
	);
	const contactLabel = $derived(
		contactsForClient.find((o) => o.id === $formData.contactId)?.label ??
			contactOptions.find((o) => o.id === $formData.contactId)?.label ??
			($formData.contactId ? 'Selected contact' : 'No contact')
	);
	const quoteLabel = $derived(
		quoteOptions.find((o) => o.id === $formData.quoteId)?.label ?? 'Blank draft (no quote)'
	);
	const NONE = '__none__';

	$effect(() => {
		const selected = clientOptions.find((o) => o.id === $formData.clientId);
		if (selected && $formData.clientName !== selected.name) {
			$formData.clientName = selected.name;
		}
	});

	$effect(() => {
		if (!$formData.contactId) return;
		const match = contactOptions.find((c) => c.id === $formData.contactId);
		// Missing from the loaded page must not clear a persisted selection.
		if (!match) return;
		if (match.clientId && $formData.clientId && match.clientId !== $formData.clientId) {
			$formData.contactId = '';
		}
	});
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="invoice-form"
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
	{#if showQuotePrefill && quoteOptions.length > 0}
		<div class="space-y-2">
			<Label for="invoice-quote">From accepted quote</Label>
			<Select.Root
				type="single"
				value={$formData.quoteId || NONE}
				onValueChange={(value) => {
					$formData.quoteId = !value || value === NONE ? '' : value;
				}}
				name="quoteId"
				disabled={readonly}
			>
				<Select.Trigger id="invoice-quote" class="w-full">{quoteLabel}</Select.Trigger>
				<Select.Content>
					<Select.Item value={NONE} label="Blank draft (no quote)">Blank draft (no quote)</Select.Item>
					{#each quoteOptions as option (option.id)}
						<Select.Item value={option.id} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-muted-foreground text-xs">
				Converting an accepted quote copies party and line snapshots into a new draft invoice.
			</p>
		</div>
	{/if}

	{#if useClientSelect}
		<div class="space-y-2">
			<Label for="invoice-client">Client</Label>
			<Select.Root
				type="single"
				bind:value={$formData.clientId}
				name="clientId"
				disabled={readonly || Boolean($formData.quoteId)}
			>
				<Select.Trigger id="invoice-client" class="w-full" aria-invalid={!!$errors.clientId}>
					{clientLabel}
				</Select.Trigger>
				<Select.Content>
					{#each clientOptions as option (option.id)}
						<Select.Item value={option.id} label={option.name}>{option.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
		</div>
	{:else}
		<div class="space-y-2">
			<Label for="invoice-client">Client</Label>
			<Input
				id="invoice-client"
				name="clientName"
				bind:value={$formData.clientName}
				placeholder="Northwind"
				aria-invalid={!!$errors.clientName}
				disabled={readonly}
			/>
			{#if $errors.clientName}<p class="text-destructive text-xs">{$errors.clientName}</p>{/if}
			{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
		</div>
	{/if}

	{#if contactsForClient.length > 0}
		<div class="space-y-2">
			<Label for="invoice-contact">Billing contact</Label>
			<Select.Root
				type="single"
				value={$formData.contactId || NONE}
				onValueChange={(value) => {
					$formData.contactId = !value || value === NONE ? '' : value;
				}}
				name="contactId"
				disabled={readonly || Boolean($formData.quoteId)}
			>
				<Select.Trigger id="invoice-contact" class="w-full">{contactLabel}</Select.Trigger>
				<Select.Content>
					<Select.Item value={NONE} label="No contact">No contact</Select.Item>
					{#each contactsForClient as option (option.id)}
						<Select.Item value={option.id} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="invoice-currency">Currency</Label>
			<Select.Root
				type="single"
				bind:value={$formData.currency}
				name="currency"
				disabled={readonly || Boolean($formData.quoteId)}
			>
				<Select.Trigger id="invoice-currency" class="w-full">{currencyLabel}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="invoice-po">PO number</Label>
			<Input
				id="invoice-po"
				name="purchaseOrderNumber"
				bind:value={$formData.purchaseOrderNumber}
				placeholder="Optional"
				disabled={readonly}
			/>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="invoice-issue">Issue on</Label>
			<DateField
				id="invoice-issue"
				name="issueOn"
				bind:value={$formData.issueOn}
				disabled={readonly}
				readonly={readonly}
			/>
			{#if $errors.issueOn}<p class="text-destructive text-xs">{$errors.issueOn}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="invoice-due">Due on</Label>
			<DateField
				id="invoice-due"
				name="dueOn"
				bind:value={$formData.dueOn}
				disabled={readonly}
				readonly={readonly}
			/>
			{#if $errors.dueOn}<p class="text-destructive text-xs">{$errors.dueOn}</p>{/if}
		</div>
	</div>

	{#if !readonly}
		<Button type="submit" disabled={busy}>{submitLabel}</Button>
	{/if}
</form>
