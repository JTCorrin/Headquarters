<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { getAuthSession, safeNextPath } from '$lib/auth/index.js';
	import AuthCredentialsForm from '$lib/components/crm/auth-credentials-form.svelte';
	import AuthProviderOptions from '$lib/components/crm/auth-provider-options.svelte';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { authCredentialsSchema } from '$lib/schemas/auth.js';

	const auth = getAuthSession();
	let formError = $state<string | null>(null);
	const next = $derived(safeNextPath(page.url.searchParams.get('next')));
	const nextQuery = $derived(next === '/' ? '' : `?next=${encodeURIComponent(next)}`);
	const invitedLogin = $derived(next.startsWith('/invite/accept'));
	const callbackError = $derived(page.url.searchParams.get('error'));
	const displayedError = $derived(formError ?? callbackError);

	const credentialsForm = superForm(
		defaults({ displayName: '', email: '', password: '' }, zod4(authCredentialsSchema)),
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
		const destination = next;
		const result = await auth.signIn(data.email, data.password);
		if (result.error) {
			formError = result.error;
			return false;
		}
		// Superforms SPA submit can ignore layout `goto` until this callback returns
		// (signup navigates here for the same reason). Overlay still hides this page
		// so it cannot stack under org setup; replaceState avoids a login history entry.
		await goto(resolve(destination as '/'), { replaceState: true });
		return true;
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader
		title="Sign in"
		description={invitedLogin
			? 'Sign in with the email that received the invitation, then you’ll return to accept it.'
			: 'Email and password for Headquarters.'}
	/>
	<Card.Root>
		<Card.Header>
			<Card.Title>{invitedLogin ? 'Continue to your invitation' : 'Welcome back'}</Card.Title>
			<Card.Description>
				{invitedLogin
					? 'Use the exact verified email the invite was sent to.'
					: 'Use the account you created during signup.'}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<AuthCredentialsForm
				form={credentialsForm}
				submitLabel="Sign in"
				errorMessage={displayedError}
				onValidSubmit={handleSubmit}
			/>
			<div class="text-right">
				<!-- The dynamic suffix contains only an encoded, sanitized `next` path. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="text-sm text-muted-foreground underline"
					href={`${resolve('/forgot-password')}${nextQuery}`}
				>
					Forgot password?
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
			<AuthProviderOptions {next} />
		</Card.Content>
		<Card.Footer class="justify-center">
			<p class="text-sm text-muted-foreground">
				New here?
				<!-- The dynamic suffix contains only an encoded, sanitized `next` path. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="text-foreground underline"
					href={`${resolve('/signup')}${nextQuery}`}
					data-testid="auth-goto-signup">Create an account</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</p>
		</Card.Footer>
	</Card.Root>
</div>
