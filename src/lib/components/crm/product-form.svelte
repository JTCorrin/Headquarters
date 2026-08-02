<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProductFormData } from '$lib/schemas/product.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProductFormProps {
		form: SuperForm<ProductFormData>;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save product',
		class: className,
		onValidSubmit
	}: ProductFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const statusOptions = [
		{ value: 'active', label: 'Active' },
		{ value: 'archived', label: 'Archived' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Select status'
	);
</script>

<form
	method="POST"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			if (!onValidSubmit) return;
			if (submitLock) return false;
			submitLock = true;
			pendingSubmit = true;
			try {
				return await onValidSubmit();
			} catch {
				return false;
			} finally {
				submitLock = false;
				pendingSubmit = false;
			}
		}
	}}
	class={cn('space-y-4', className)}
	data-testid="product-form"
>
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="product-sku">SKU</Label>
			<Input
				id="product-sku"
				name="sku"
				bind:value={$formData.sku}
				placeholder="SVC-RETAIN"
				aria-invalid={!!$errors.sku}
			/>
			{#if $errors.sku}<p class="text-destructive text-xs">{$errors.sku}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="product-status">Status</Label>
			<Select.Root type="single" bind:value={$formData.status} name="status">
				<Select.Trigger id="product-status" class="w-full" aria-invalid={!!$errors.status}>
					{statusLabel}
				</Select.Trigger>
				<Select.Content>
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if $errors.status}<p class="text-destructive text-xs">{$errors.status}</p>{/if}
		</div>
	</div>

	<div class="space-y-2">
		<Label for="product-name">Name</Label>
		<Input
			id="product-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Monthly retainer"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="product-description">Description</Label>
		<Textarea
			id="product-description"
			name="description"
			bind:value={$formData.description}
			placeholder="Optional details for quotes and invoices"
			rows={3}
		/>
		{#if $errors.description}<p class="text-destructive text-xs">{$errors.description}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="product-unit-price">Unit price</Label>
			<Input
				id="product-unit-price"
				name="unitPrice"
				bind:value={$formData.unitPrice}
				placeholder="4200.00"
				aria-invalid={!!$errors.unitPrice}
			/>
			{#if $errors.unitPrice}<p class="text-destructive text-xs">{$errors.unitPrice}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="product-stock">Opening stock</Label>
			<Input
				id="product-stock"
				name="stockQty"
				bind:value={$formData.stockQty}
				placeholder="Leave blank for services"
				disabled={!$formData.trackStock}
				aria-invalid={!!$errors.stockQty}
			/>
			{#if $errors.stockQty}<p class="text-destructive text-xs">{$errors.stockQty}</p>{/if}
		</div>
	</div>

	<label class="flex items-center gap-2 text-sm">
		<input
			type="checkbox"
			name="trackStock"
			bind:checked={$formData.trackStock}
			class="accent-primary size-4 rounded"
		/>
		Track inventory for this product
	</label>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
