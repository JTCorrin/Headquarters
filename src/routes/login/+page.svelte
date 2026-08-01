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
		const result = await auth.signIn(data.email, data.password);
		if (result.error) {
			formError = result.error;
			return false;
		}
		void goto('/');
		return true;
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader title="Sign in" description="Email and password for Headquarters." />
	<Card.Root>
		<Card.Header>
			<Card.Title>Welcome back</Card.Title>
			<Card.Description>Use the account you created during signup.</Card.Description>
		</Card.Header>
		<Card.Content>
			<AuthCredentialsForm
				form={credentialsForm}
				submitLabel="Sign in"
				errorMessage={formError}
				onValidSubmit={handleSubmit}
			/>
		</Card.Content>
		<Card.Footer class="justify-center">
			<p class="text-muted-foreground text-sm">
				New here?
				<a class="text-foreground underline" href="/signup" data-testid="auth-goto-signup"
					>Create an account</a
				>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
