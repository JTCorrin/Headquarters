<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface LineItemFormProps {
		form: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		submitLabel?: string;
		class?: string;
	}

	let {
		form,
		products = [],
		submitLabel = 'Add line',
		class: className
	}: LineItemFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	const NONE = '__none__';

	const productLabel = $derived.by(() => {
		const id = $formData.productId;
		if (!id) return 'No product (custom line)';
		const match = products.find((p) => p.id === id);
		return match ? `${match.sku} · ${match.name}` : 'Product';
	});

	function linkProduct(productId: string) {
		if (productId === NONE) {
			$formData.productId = '';
			return;
		}
		$formData.productId = productId;
		const match = products.find((p) => p.id === productId);
		if (!match) return;
		$formData.description = match.name;
		$formData.unitPrice = match.unitPrice;
		if (!$formData.qty) $formData.qty = '1';
	}
</script>

<form method="POST" use:enhance class={cn('space-y-4', className)}>
	<div class="space-y-2">
		<Label for="line-product">Link product</Label>
		<Select.Root
			type="single"
			value={$formData.productId || NONE}
			onValueChange={(value) => {
				if (value) linkProduct(value);
			}}
			name="productId"
		>
			<Select.Trigger id="line-product" class="w-full">{productLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value={NONE} label="No product (custom line)">No product (custom line)</Select.Item>
				{#each products as product (product.id)}
					<Select.Item value={product.id} label={`${product.sku} · ${product.name}`}>
						{product.sku} · {product.name}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-muted-foreground text-xs">
			Choosing a catalog product fills description and unit price; you can still edit them.
		</p>
	</div>

	<div class="space-y-2">
		<Label for="line-description">Description</Label>
		<Input
			id="line-description"
			name="description"
			bind:value={$formData.description}
			placeholder="Monthly retainer"
			aria-invalid={!!$errors.description}
		/>
		{#if $errors.description}<p class="text-destructive text-xs">{$errors.description}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="line-qty">Qty</Label>
			<Input id="line-qty" name="qty" bind:value={$formData.qty} placeholder="1" />
			{#if $errors.qty}<p class="text-destructive text-xs">{$errors.qty}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="line-unit">Unit price</Label>
			<Input
				id="line-unit"
				name="unitPrice"
				bind:value={$formData.unitPrice}
				placeholder="4200.00"
			/>
			{#if $errors.unitPrice}<p class="text-destructive text-xs">{$errors.unitPrice}</p>{/if}
		</div>
	</div>

	<Button type="submit" disabled={$submitting}>{submitLabel}</Button>
</form>
