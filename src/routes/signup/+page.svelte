<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { authCallbackUrl, getAuthSession, safeNextPath } from '$lib/auth/index.js';
	import AuthCredentialsForm from '$lib/components/crm/auth-credentials-form.svelte';
	import AuthProviderOptions from '$lib/components/crm/auth-provider-options.svelte';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { authSignUpSchema } from '$lib/schemas/auth.js';

	const auth = getAuthSession();
	let formError = $state<string | null>(null);
	const next = $derived(safeNextPath(page.url.searchParams.get('next')));
	const nextQuery = $derived(next === '/' ? '' : `?next=${encodeURIComponent(next)}`);
	const invitedSignup = $derived(next.startsWith('/invite/accept'));

	const credentialsForm = superForm(
		defaults({ displayName: '', email: '', password: '' }, zod4(authSignUpSchema)),
		{
			validators: zod4(authSignUpSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	async function handleSubmit(): Promise<boolean> {
		formError = null;
		const data = get(credentialsForm.form);
		const result = await auth.signUp(data.email, data.password, {
			displayName: data.displayName?.trim() || undefined,
			emailRedirectTo: authCallbackUrl(window.location.origin, next)
		});
		if (result.error) {
			formError = result.error;
			return false;
		}
		if (result.requiresEmailConfirmation) {
			const query = `email=${encodeURIComponent(data.email)}${
				next === '/' ? '' : `&next=${encodeURIComponent(next)}`
			}`;
			void goto(resolve(`/check-email?${query}`));
			return true;
		}
		// `next` is runtime data, but safeNextPath has restricted it to this origin.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void goto(next);
		return true;
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader
		title="Create account"
		description={invitedSignup
			? 'Use the email address that received the invitation, then you’ll return to accept it.'
			: 'Sign up with email and password, or use SSO / a provider.'}
	/>
	<Card.Root>
		<Card.Header>
			<Card.Title>{invitedSignup ? 'Join with your invited email' : 'Get started'}</Card.Title>
			<Card.Description>
				{invitedSignup
					? 'After your account is ready, we’ll take you back to the invitation.'
					: 'Create your Headquarters login, then set up an organisation.'}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<AuthCredentialsForm
				form={credentialsForm}
				submitLabel="Sign up"
				showDisplayName
				passwordAutocomplete="new-password"
				errorMessage={formError}
				onValidSubmit={handleSubmit}
			/>
			<AuthProviderOptions {next} />
		</Card.Content>
		<Card.Footer class="justify-center">
			<p class="text-sm text-muted-foreground">
				Already have an account?
				<!-- The dynamic suffix contains only an encoded, sanitized `next` path. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="text-foreground underline"
					href={`${resolve('/login')}${nextQuery}`}
					data-testid="auth-goto-login">Sign in</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</p>
		</Card.Footer>
	</Card.Root>
</div>
