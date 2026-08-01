<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { authCredentialsSchema, type AuthCredentialsData } from '$lib/schemas/auth.js';
	import AuthCredentialsForm from './auth-credentials-form.svelte';

	export interface AuthCredentialsFormTestHostProps {
		initial?: Partial<AuthCredentialsData>;
		submitLabel?: string;
		errorMessage?: string | null;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		initial = {},
		submitLabel = 'Sign in',
		errorMessage = null,
		onValidSubmit
	}: AuthCredentialsFormTestHostProps = $props();

	const form = superForm(
		defaults({ email: '', password: '', ...initial }, zod4(authCredentialsSchema)),
		{
			validators: zod4(authCredentialsSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<AuthCredentialsForm {form} {submitLabel} {errorMessage} {onValidSubmit} />
