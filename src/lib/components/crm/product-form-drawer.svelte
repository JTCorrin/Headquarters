<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProductFormData } from '$lib/schemas/product.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ProductForm from './product-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface ProductFormDrawerProps {
		form: SuperForm<ProductFormData>;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		class?: string;
		trigger?: Snippet;
	}

	let {
		form,
		open = $bindable(false),
		title = 'New product',
		description = 'Add a catalog item for quotes, invoices, and inventory.',
		submitLabel = 'Save product',
		triggerLabel = 'New product',
		class: className,
		trigger
	}: ProductFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if trigger}
		<Drawer.Trigger>
			{@render trigger()}
		</Drawer.Trigger>
	{:else}
		<Drawer.Trigger>
			<Button type="button">{triggerLabel}</Button>
		</Drawer.Trigger>
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<ProductForm {form} {submitLabel} />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
