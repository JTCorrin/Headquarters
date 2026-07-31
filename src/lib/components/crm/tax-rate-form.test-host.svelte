<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { taxRateFormSchema, type TaxRateFormData } from '$lib/schemas/organisation.js';
	import TaxRateForm from './tax-rate-form.svelte';

	export interface TaxRateFormTestHostProps {
		initial?: Partial<TaxRateFormData>;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let { initial = {}, onValidSubmit }: TaxRateFormTestHostProps = $props();

	const form = superForm(
		defaults(
			{
				name: 'VAT 20%',
				ratePercent: '20',
				isDefault: 'true',
				active: 'true',
				...initial
			},
			zod4(taxRateFormSchema)
		),
		{
			validators: zod4(taxRateFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<TaxRateForm {form} {onValidSubmit} />
