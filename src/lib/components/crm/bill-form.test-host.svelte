<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		billFormSchema,
		type BillFormData,
		type BillVendorOption
	} from '$lib/schemas/bill.js';
	import BillForm from './bill-form.svelte';

	export interface BillFormTestHostProps {
		initial?: Partial<BillFormData>;
		vendorOptions?: BillVendorOption[];
		/** When false, omit onCreateVendor (Storybook-style free-text fallback). */
		enableCreateVendor?: boolean;
		onCreateVendor?: () => void;
	}

	let {
		initial = {},
		vendorOptions = [],
		enableCreateVendor = true,
		onCreateVendor
	}: BillFormTestHostProps = $props();

	let createVendorCalls = $state(0);

	const data = defaults(
		{
			vendorId: '00000000-0000-4000-8000-000000000000',
			vendorName: '',
			number: '',
			internalReference: '',
			currency: 'GBP',
			issueOn: '',
			receivedOn: '',
			dueOn: '2026-04-01',
			notes: '',
			status: 'draft',
			...initial
		},
		zod4(billFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(billFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const createHandler = $derived(
		enableCreateVendor
			? (onCreateVendor ??
					(() => {
						createVendorCalls += 1;
					}))
			: undefined
	);
</script>

<div data-testid="bill-form-test-host" data-create-vendor-calls={createVendorCalls}>
	<BillForm {form} {vendorOptions} onCreateVendor={createHandler} />
</div>
