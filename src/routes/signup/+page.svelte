<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { authCallbackUrl, getAuthSession, safeNextPath } from '$lib/auth/index.js';
	import AuthCredentialsForm from '$lib/components/crm/auth-credentials-form.svelte';
	import AuthProviderOptions from '$lib/components/crm/auth-provider-options.svelte';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { storeHostedClaimToken, clearHostedClaimToken } from '$lib/hosted/claim-storage.js';
	import { authSignUpSchema } from '$lib/schemas/auth.js';

	const auth = getAuthSession();
	let formError = $state<string | null>(null);
	const next = $derived(safeNextPath(page.url.searchParams.get('next')));
	const nextQuery = $derived(next === '/' ? '' : `?next=${encodeURIComponent(next)}`);
	const invitedSignup = $derived(next.startsWith('/invite/accept'));
	const claimToken = $derived(page.url.searchParams.get('claim')?.trim() ?? '');
	const hostedBilling = $derived(
		['1', 'true', 'yes'].includes((env.PUBLIC_HOSTED_BILLING ?? '').trim().toLowerCase())
	);
	const landingUrl = $derived((env.PUBLIC_LANDING_URL ?? '').trim().replace(/\/$/, ''));

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

	type ClaimState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'ready'; email: string | null; usable: boolean; message?: string }
		| { status: 'error'; message: string };

	let claimState = $state<ClaimState>({ status: 'idle' });

	$effect(() => {
		const token = claimToken;
		if (!token) {
			claimState = { status: 'idle' };
			return;
		}
		storeHostedClaimToken(token);
		let cancelled = false;
		claimState = { status: 'loading' };
		void (async () => {
			try {
				const res = await fetch(`/api/hosted/claim?token=${encodeURIComponent(token)}`);
				const data = (await res.json()) as {
					email?: string | null;
					usable?: boolean;
					already_claimed?: boolean;
					expired?: boolean;
					status?: string;
					error?: string;
				};
				if (cancelled) return;
				if (!res.ok) {
					claimState = {
						status: 'error',
						message: data.error ?? 'This payment link is invalid.'
					};
					return;
				}
				if (data.already_claimed) {
					claimState = {
						status: 'ready',
						email: data.email ?? null,
						usable: false,
						message: 'This payment is already linked to an account. Sign in instead.'
					};
					return;
				}
				if (data.expired) {
					claimState = {
						status: 'ready',
						email: data.email ?? null,
						usable: false,
						message: 'This payment link has expired. Start checkout again from the pricing page.'
					};
					return;
				}
				if (!data.usable) {
					claimState = {
						status: 'ready',
						email: data.email ?? null,
						usable: false,
						message:
							data.status === 'pending_checkout'
								? 'Payment is still processing — refresh in a moment.'
								: 'This payment is not ready for signup yet.'
					};
					return;
				}
				claimState = {
					status: 'ready',
					email: data.email ?? null,
					usable: true
				};
				if (data.email) {
					credentialsForm.form.update((current) => ({ ...current, email: data.email! }));
				}
			} catch {
				if (!cancelled) {
					claimState = { status: 'error', message: 'Could not verify payment. Try again.' };
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const emailLocked = $derived(
		claimState.status === 'ready' && Boolean(claimState.email) && claimState.usable
	);
	const blockOpenSignup = $derived(hostedBilling && !claimToken && !invitedSignup);
	const showForm = $derived(
		!blockOpenSignup &&
			(!claimToken || (claimState.status === 'ready' && claimState.usable))
	);

	async function handleSubmit(): Promise<boolean> {
		formError = null;
		if (hostedBilling && claimToken) {
			if (claimState.status !== 'ready' || !claimState.usable) {
				formError = 'Payment is not ready to claim yet.';
				return false;
			}
		}
		const data = get(credentialsForm.form);
		if (claimToken) {
			storeHostedClaimToken(claimToken);
		}
		const result = await auth.signUp(data.email, data.password, {
			displayName: data.displayName?.trim() || undefined,
			emailRedirectTo: authCallbackUrl(window.location.origin, next)
		});
		if (result.error) {
			formError = result.error;
			return false;
		}

		if (claimToken && !result.requiresEmailConfirmation) {
			const claimRes = await fetch('/api/hosted/claim', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: claimToken })
			});
			if (!claimRes.ok) {
				const claimBody = (await claimRes.json().catch(() => ({}))) as { error?: string };
				formError =
					claimBody.error ??
					'Account created, but linking payment failed. Sign in and contact support.';
				return false;
			}
			clearHostedClaimToken();
		}

		if (result.requiresEmailConfirmation) {
			const query = `email=${encodeURIComponent(data.email)}${
				next === '/' ? '' : `&next=${encodeURIComponent(next)}`
			}`;
			await goto(resolve(`/check-email?${query}`), { replaceState: true });
			return true;
		}
		const destination = next === '/' ? '/onboarding/create-org' : next;
		await goto(resolve(destination as '/'), { replaceState: true });
		return true;
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader
		title="Create account"
		description={invitedSignup
			? 'Use the email address that received the invitation, then you’ll return to accept it.'
			: claimToken
				? 'Payment received — create your login to finish setup.'
				: 'Sign up with email and password, or use SSO / a provider.'}
	/>
	<Card.Root>
		<Card.Header>
			<Card.Title>
				{invitedSignup
					? 'Join with your invited email'
					: claimToken
						? 'Finish hosted signup'
						: 'Get started'}
			</Card.Title>
			<Card.Description>
				{invitedSignup
					? 'After your account is ready, we’ll take you back to the invitation.'
					: claimToken
						? 'Use the email from checkout if it was collected, then set a password.'
						: 'Create your Headquarters login, then set up an organisation.'}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if blockOpenSignup}
				<p class="text-sm text-muted-foreground" data-testid="hosted-signup-required">
					Hosted accounts start from the pricing page after payment.
				</p>
				{#if landingUrl}
					<a class="text-sm text-foreground underline" href={`${landingUrl}/#pricing`}>
						Go to pricing
					</a>
				{/if}
			{:else if claimToken && claimState.status === 'loading'}
				<p class="text-sm text-muted-foreground">Verifying payment…</p>
			{:else if claimToken && claimState.status === 'error'}
				<p class="text-sm text-destructive" role="alert">{claimState.message}</p>
			{:else if claimToken && claimState.status === 'ready' && !claimState.usable}
				<p class="text-sm text-muted-foreground" role="status">{claimState.message}</p>
				{#if landingUrl}
					<a class="text-sm text-foreground underline" href={`${landingUrl}/#pricing`}>
						Back to pricing
					</a>
				{/if}
			{:else if showForm}
				<AuthCredentialsForm
					form={credentialsForm}
					submitLabel="Sign up"
					showDisplayName
					emailLocked={emailLocked}
					passwordAutocomplete="new-password"
					errorMessage={formError}
					onValidSubmit={handleSubmit}
				/>
				{#if !claimToken}
					<AuthProviderOptions {next} />
				{/if}
			{/if}
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
