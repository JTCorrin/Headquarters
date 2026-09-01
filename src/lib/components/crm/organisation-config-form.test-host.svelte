<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		organisationConfigSchema,
		type OrganisationConfigData
	} from '$lib/schemas/organisation.js';
	import OrganisationConfigForm from './organisation-config-form.svelte';

	export interface OrganisationConfigFormTestHostProps {
		initial?: Partial<OrganisationConfigData>;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let { initial = {}, onValidSubmit }: OrganisationConfigFormTestHostProps = $props();

	const form = superForm(
		defaults(
			{
				name: 'Corrin Data',
				legalName: '',
				phone: '',
				billingEmail: '',
				websiteUrl: '',
				taxIdentifier: '',
				registrationNumber: '',
				addressLine1: '',
				addressLine2: '',
				city: '',
				region: '',
				postalCode: '',
				country: 'GB',
				timezone: 'Europe/London',
				currency: 'GBP',
				locale: 'en-GB',
				themeDefault: 'system',
				...initial
			},
			zod4(organisationConfigSchema)
		),
		{
			validators: zod4(organisationConfigSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<OrganisationConfigForm {form} {onValidSubmit} />
