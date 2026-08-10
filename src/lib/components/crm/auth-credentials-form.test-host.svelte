<script lang="ts">
	import { untrack } from 'svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { authCredentialsSchema, type AuthCredentialsData } from '$lib/schemas/auth.js';
	import AuthCredentialsForm from './auth-credentials-form.svelte';

	export interface AuthCredentialsFormTestHostProps {
		initial?: Partial<AuthCredentialsData>;
		submitLabel?: string;
		errorMessage?: string | null;
		showDisplayName?: boolean;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		initial = {},
		submitLabel = 'Sign in',
		errorMessage = null,
		showDisplayName = false,
		onValidSubmit
	}: AuthCredentialsFormTestHostProps = $props();

	const initialValues = untrack(() => initial);
	const form = superForm(
		defaults(
			{ displayName: '', email: '', password: '', ...initialValues },
			zod4(authCredentialsSchema)
		),
		{
			validators: zod4(authCredentialsSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<AuthCredentialsForm {form} {submitLabel} {errorMessage} {showDisplayName} {onValidSubmit} />
