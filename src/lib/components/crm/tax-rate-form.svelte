<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { TaxRateFormData } from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface TaxRateFormProps {
		form: SuperForm<TaxRateFormData>;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => void;
	}

	let {
		form,
		submitLabel = 'Save tax rate',
		class: className,
		onValidSubmit
	}: TaxRateFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	const defaultLabel = $derived($formData.isDefault === 'true' ? 'Yes' : 'No');
	const activeLabel = $derived($formData.active === 'true' ? 'Active' : 'Archived');

	function onDefaultChange(value: string | undefined) {
		if (!value) return;
		$formData.isDefault = value as TaxRateFormData['isDefault'];
		if (value === 'true') {
			$formData.active = 'true';
		}
	}

	function onActiveChange(value: string | undefined) {
		if (!value) return;
		$formData.active = value as TaxRateFormData['active'];
		if (value === 'false') {
			$formData.isDefault = 'false';
		}
	}
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="tax-rate-form"
	use:enhance={{
		onUpdate({ form: validated }) {
			if (!validated.valid) return;
			onValidSubmit?.();
		}
	}}
>
	<div class="space-y-2">
		<Label for="tax-rate-name">Name</Label>
		<Input
			id="tax-rate-name"
			name="name"
			bind:value={$formData.name}
			placeholder="VAT 20%"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="tax-rate-percent">Rate (%)</Label>
		<Input
			id="tax-rate-percent"
			name="ratePercent"
			bind:value={$formData.ratePercent}
			placeholder="20"
			aria-invalid={!!$errors.ratePercent}
		/>
		{#if $errors.ratePercent}<p class="text-destructive text-xs">{$errors.ratePercent}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="tax-rate-default">Default</Label>
			<Select.Root
				type="single"
				value={$formData.isDefault}
				onValueChange={onDefaultChange}
				name="isDefault"
			>
				<Select.Trigger id="tax-rate-default" class="w-full" data-testid="tax-rate-default-trigger">
					{defaultLabel}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="true" label="Yes">Yes</Select.Item>
					<Select.Item value="false" label="No">No</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="tax-rate-active">Status</Label>
			<Select.Root
				type="single"
				value={$formData.active}
				onValueChange={onActiveChange}
				name="active"
			>
				<Select.Trigger id="tax-rate-active" class="w-full" data-testid="tax-rate-active-trigger">
					{activeLabel}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="true" label="Active">Active</Select.Item>
					<Select.Item
						value="false"
						label="Archived"
						disabled={$formData.isDefault === 'true'}
						data-testid="tax-rate-active-archived"
					>
						Archived
					</Select.Item>
				</Select.Content>
			</Select.Root>
			{#if $errors.active}<p class="text-destructive text-xs">{$errors.active}</p>{/if}
			{#if $formData.isDefault === 'true'}
				<p class="text-muted-foreground text-xs">
					The organisation default cannot be archived.
				</p>
			{/if}
		</div>
	</div>

	<div class="flex justify-end">
		<Button type="submit" disabled={$submitting} data-testid="tax-rate-submit">
			{$submitting ? 'Saving…' : submitLabel}
		</Button>
	</div>
</form>
