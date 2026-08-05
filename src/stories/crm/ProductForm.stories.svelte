<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProductFormDrawer from '$lib/components/crm/product-form-drawer.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/ProductForm',
		component: ProductFormDrawer,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { productFormSchema } from '$lib/schemas/product.js';

	const data = defaults(
		{
			sku: '',
			name: '',
			description: '',
			categoryId: '',
			unitPrice: '',
			taxRateId: '',
			trackStock: true,
			stockQty: '10',
			status: 'active'
		},
		zod4(productFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(productFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});

	let open = $state(true);
</script>

<Story name="Drawer">
	{#snippet template()}
		<div class="bg-background flex h-[640px] items-start justify-center p-8">
			<ProductFormDrawer bind:open {form} />
		</div>
	{/snippet}
</Story>
