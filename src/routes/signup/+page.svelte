<script lang="ts">
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { getAuthSession } from '$lib/auth/index.js';
	import AuthCredentialsForm from '$lib/components/crm/auth-credentials-form.svelte';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { authCredentialsSchema } from '$lib/schemas/auth.js';

	const auth = getAuthSession();
	let formError = $state<string | null>(null);

	const credentialsForm = superForm(
		defaults({ email: '', password: '' }, zod4(authCredentialsSchema)),
		{
			validators: zod4(authCredentialsSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	async function handleSubmit(): Promise<boolean> {
		formError = null;
		const data = get(credentialsForm.form);
		const result = await auth.signUp(data.email, data.password);
		if (result.error) {
			formError = result.error;
			return false;
		}
		// With confirmations off, session is usually present; still land on `/` for guards.
		void goto('/');
		return true;
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader title="Create account" description="Email and password signup (MVP)." />
	<Card.Root>
		<Card.Header>
			<Card.Title>Get started</Card.Title>
			<Card.Description>Create your Headquarters login, then set up an organisation.</Card.Description>
		</Card.Header>
		<Card.Content>
			<AuthCredentialsForm
				form={credentialsForm}
				submitLabel="Sign up"
				passwordAutocomplete="new-password"
				errorMessage={formError}
				onValidSubmit={handleSubmit}
			/>
		</Card.Content>
		<Card.Footer class="justify-center">
			<p class="text-muted-foreground text-sm">
				Already have an account?
				<a class="text-foreground underline" href="/login" data-testid="auth-goto-login"
					>Sign in</a
				>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
