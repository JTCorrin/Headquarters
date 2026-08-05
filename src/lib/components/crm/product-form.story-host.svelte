<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		productFormSchema,
		type ProductCategoryOption,
		type ProductFormData
	} from '$lib/schemas/product.js';
	import ProductForm from './product-form.svelte';

	export interface ProductFormStoryHostProps {
		categoryOptions?: ProductCategoryOption[];
		initial?: Partial<ProductFormData>;
	}

	let { categoryOptions = [], initial = {} }: ProductFormStoryHostProps = $props();

	const form = superForm(
		defaults(
			{
				sku: 'SKU-1',
				name: 'Widget',
				description: '',
				categoryId: '',
				unitPrice: '10.00',
				taxRateId: '',
				trackStock: false,
				stockQty: '',
				status: 'active' as const,
				...initial
			},
			zod4(productFormSchema)
		),
		{
			validators: zod4(productFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<ProductForm {form} {categoryOptions} />
