<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { leadFormSchema, type LeadFormData } from '$lib/schemas/lead.js';
	import LeadForm from './lead-form.svelte';

	export interface LeadFormTestHostProps {
		initial?: Partial<LeadFormData>;
	}

	let { initial = {} }: LeadFormTestHostProps = $props();

	const data = defaults(
		{
			name: '',
			companyName: '',
			primaryEmail: '',
			clientId: '',
			stage: 'new',
			valueAmount: '',
			currency: 'GBP',
			probabilityPercent: '',
			source: '',
			expectedCloseOn: '',
			lostReason: '',
			notes: '',
			...initial
		},
		zod4(leadFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(leadFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});
</script>

<LeadForm {form} orgCurrency="GBP" />
