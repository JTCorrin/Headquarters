<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ClientFormData } from '$lib/schemas/client.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import DateField from './date-field.svelte';
	import { cn } from '$lib/utils.js';

	export interface ClientFormProps {
		form: SuperForm<ClientFormData>;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save client',
		class: className,
		onValidSubmit
	}: ClientFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const statusOptions = [
		{ value: 'prospect', label: 'Prospect' },
		{ value: 'active', label: 'Active' },
		{ value: 'on_hold', label: 'On hold' },
		{ value: 'inactive', label: 'Inactive' },
		{ value: 'archived', label: 'Archived' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
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
	data-testid="client-form"
>
	<div class="space-y-2">
		<Label for="client-name">Name</Label>
		<Input
			id="client-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Northwind"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="client-status">Status</Label>
			<Select.Root type="single" bind:value={$formData.status} name="status">
				<Select.Trigger id="client-status" class="w-full">{statusLabel}</Select.Trigger>
				<Select.Content>
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="client-currency">Default currency</Label>
			<Input
				id="client-currency"
				name="defaultCurrency"
				bind:value={$formData.defaultCurrency}
				placeholder="GBP"
				aria-invalid={!!$errors.defaultCurrency}
			/>
			{#if $errors.defaultCurrency}
				<p class="text-destructive text-xs">{$errors.defaultCurrency}</p>
			{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="client-email">Primary email</Label>
			<Input
				id="client-email"
				name="primaryEmail"
				type="email"
				bind:value={$formData.primaryEmail}
				placeholder="billing@northwind.com"
				aria-invalid={!!$errors.primaryEmail}
			/>
			{#if $errors.primaryEmail}<p class="text-destructive text-xs">{$errors.primaryEmail}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="client-phone">Phone</Label>
			<Input id="client-phone" name="phone" bind:value={$formData.phone} />
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="client-website">Website</Label>
			<Input
				id="client-website"
				name="websiteUrl"
				bind:value={$formData.websiteUrl}
				placeholder="https://northwind.com"
			/>
		</div>
		<div class="space-y-2">
			<Label for="client-industry">Industry</Label>
			<Input id="client-industry" name="industry" bind:value={$formData.industry} />
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="client-terms">Payment terms (days)</Label>
			<Input
				id="client-terms"
				name="paymentTermsDays"
				bind:value={$formData.paymentTermsDays}
				placeholder="30"
				aria-invalid={!!$errors.paymentTermsDays}
			/>
			{#if $errors.paymentTermsDays}
				<p class="text-destructive text-xs">{$errors.paymentTermsDays}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="client-renewal">Renewal on</Label>
			<DateField
				id="client-renewal"
				name="renewalOn"
				bind:value={$formData.renewalOn}
				aria-invalid={!!$errors.renewalOn}
			/>
			{#if $errors.renewalOn}<p class="text-destructive text-xs">{$errors.renewalOn}</p>{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="client-tax">Tax identifier</Label>
			<Input id="client-tax" name="taxIdentifier" bind:value={$formData.taxIdentifier} />
		</div>
		<div class="space-y-2">
			<Label for="client-reg">Registration number</Label>
			<Input
				id="client-reg"
				name="registrationNumber"
				bind:value={$formData.registrationNumber}
			/>
		</div>
	</div>

	<label class="flex items-center gap-2 text-sm">
		<input
			type="checkbox"
			name="taxExempt"
			bind:checked={$formData.taxExempt}
			class="accent-primary size-4 rounded"
			data-testid="client-tax-exempt"
		/>
		VAT exempt (new quote/invoice lines default to 0% tax)
	</label>

	<div class="space-y-2">
		<Label for="client-notes">Notes</Label>
		<Textarea id="client-notes" name="notes" bind:value={$formData.notes} rows={3} />
	</div>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
