<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { CatalogProductOption } from '$lib/schemas/line-item.js';
	import type { RecurringLineFormData } from '$lib/schemas/recurring-invoice.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface RecurringLineFormProps {
		form: SuperForm<RecurringLineFormData>;
		products?: CatalogProductOption[];
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		products = [],
		submitLabel = 'Add line',
		class: className,
		onValidSubmit
	}: RecurringLineFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);
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
		$formData.descriptionTemplate = match.name;
		$formData.unitPrice = match.unitPrice;
		if (!$formData.qty) $formData.qty = '1';
	}
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="recurring-line-form"
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
>
	<div class="space-y-2">
		<Label for="rline-product">Link product</Label>
		<Select.Root
			type="single"
			value={$formData.productId || NONE}
			onValueChange={(value) => {
				if (value) linkProduct(value);
			}}
			name="productId"
		>
			<Select.Trigger id="rline-product" class="w-full">{productLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value={NONE} label="No product (custom line)">No product (custom line)</Select.Item>
				{#each products as product (product.id)}
					<Select.Item value={product.id} label={`${product.sku} · ${product.name}`}>
						{product.sku} · {product.name}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="space-y-2">
		<Label for="rline-description">Description template</Label>
		<Input
			id="rline-description"
			name="descriptionTemplate"
			bind:value={$formData.descriptionTemplate}
			placeholder="Retainer — {{period_start}} to {{period_end}}"
			aria-invalid={!!$errors.descriptionTemplate}
		/>
		{#if $errors.descriptionTemplate}
			<p class="text-destructive text-xs">{$errors.descriptionTemplate}</p>
		{/if}
		<p class="text-muted-foreground text-xs">
			Variables: <code>{'{{period_start}}'}</code>, <code>{'{{period_end}}'}</code>,
			<code>{'{{issue_date}}'}</code>
		</p>
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="space-y-2">
			<Label for="rline-qty">Qty</Label>
			<Input id="rline-qty" name="qty" bind:value={$formData.qty} placeholder="1" />
			{#if $errors.qty}<p class="text-destructive text-xs">{$errors.qty}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="rline-unit">Unit price</Label>
			<Input id="rline-unit" name="unitPrice" bind:value={$formData.unitPrice} placeholder="4200.00" />
			{#if $errors.unitPrice}<p class="text-destructive text-xs">{$errors.unitPrice}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="rline-tax">Tax % (optional)</Label>
			<Input id="rline-tax" name="taxRatePercent" bind:value={$formData.taxRatePercent} placeholder="20" />
		</div>
	</div>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
