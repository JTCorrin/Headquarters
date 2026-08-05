<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		ProductCategoryOption,
		ProductFormData,
		ProductTaxRateOption
	} from '$lib/schemas/product.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ProductForm from './product-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface ProductFormDrawerProps {
		form: SuperForm<ProductFormData>;
		taxRateOptions?: ProductTaxRateOption[];
		categoryOptions?: ProductCategoryOption[];
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		/** When false, drawer is controlled only via `open` (no trigger button). */
		showTrigger?: boolean;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		taxRateOptions = [],
		categoryOptions = [],
		open = $bindable(false),
		title = 'New product',
		description = 'Add a catalog item for quotes, invoices, and inventory.',
		submitLabel = 'Save product',
		triggerLabel = 'New product',
		showTrigger = true,
		class: className,
		trigger,
		onValidSubmit
	}: ProductFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if showTrigger}
		{#if trigger}
			<Drawer.Trigger>
				{@render trigger()}
			</Drawer.Trigger>
		{:else}
			<Drawer.Trigger>
				<Button type="button">{triggerLabel}</Button>
			</Drawer.Trigger>
		{/if}
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<ProductForm {form} {taxRateOptions} {categoryOptions} {submitLabel} {onValidSubmit} />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
