<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		profilePreferencesSchema,
		type ProfilePreferencesData
	} from '$lib/schemas/organisation.js';
	import ProfilePreferencesForm from './profile-preferences-form.svelte';

	export interface ProfilePreferencesFormTestHostProps {
		initial?: Partial<ProfilePreferencesData>;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let { initial = {}, onValidSubmit }: ProfilePreferencesFormTestHostProps = $props();

	const form = superForm(
		defaults(
			{
				themePreference: 'org_default',
				...initial
			},
			zod4(profilePreferencesSchema)
		),
		{
			validators: zod4(profilePreferencesSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<ProfilePreferencesForm {form} {onValidSubmit} />
