<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		organisationCreateSchema,
		type OrganisationCreateData
	} from '$lib/schemas/organisation.js';
	import OrganisationCreateForm from './organisation-create-form.svelte';

	export interface OrganisationCreateFormTestHostProps {
		initial?: Partial<OrganisationCreateData>;
		onValidSubmit?: () => void;
	}

	let { initial = {}, onValidSubmit }: OrganisationCreateFormTestHostProps = $props();

	const form = superForm(
		defaults(
			{
				name: '',
				slug: '',
				timezone: 'Europe/London',
				currency: 'GBP',
				locale: 'en-GB',
				country: 'GB',
				...initial
			},
			zod4(organisationCreateSchema)
		),
		{
			validators: zod4(organisationCreateSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<OrganisationCreateForm {form} {onValidSubmit} />
