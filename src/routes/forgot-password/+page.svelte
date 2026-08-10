<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authCallbackUrl, getAuthSession, safeNextPath } from '$lib/auth/index.js';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	const auth = getAuthSession();
	const next = $derived(safeNextPath(page.url.searchParams.get('next')));
	const nextQuery = $derived(next === '/' ? '' : `?next=${encodeURIComponent(next)}`);
	let email = $state('');
	let pending = $state(false);
	let errorMessage = $state<string | null>(null);
	let sent = $state(false);

	function passwordUpdatePath(): string {
		if (next === '/') return '/update-password';
		return `/update-password?next=${encodeURIComponent(next)}`;
	}

	async function requestReset(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		errorMessage = null;
		pending = true;
		try {
			const result = await auth.requestPasswordReset(
				email.trim(),
				authCallbackUrl(window.location.origin, passwordUpdatePath())
			);
			if (result.error) {
				errorMessage = result.error;
				return;
			}
			sent = true;
		} catch {
			errorMessage = 'Could not send reset email';
		} finally {
			pending = false;
		}
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader title="Reset password" description="We’ll email you a secure password reset link." />
	<Card.Root>
		<Card.Header>
			<Card.Title>{sent ? 'Check your email' : 'Forgot your password?'}</Card.Title>
			<Card.Description>
				{sent
					? `If an account exists for ${email.trim()}, a reset link is on its way.`
					: 'Enter the email address associated with your account.'}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if sent}
				<p class="text-sm text-muted-foreground">
					For security, the message may take a few minutes to arrive.
				</p>
			{:else}
				<form class="space-y-4" onsubmit={requestReset}>
					{#if errorMessage}
						<p class="text-sm text-destructive" role="alert">{errorMessage}</p>
					{/if}
					<div class="space-y-2">
						<Label for="reset-email">Email</Label>
						<Input
							id="reset-email"
							name="email"
							type="email"
							autocomplete="email"
							required
							bind:value={email}
						/>
					</div>
					<Button type="submit" class="w-full" disabled={pending}>
						{pending ? 'Sending…' : 'Send reset link'}
					</Button>
				</form>
			{/if}
		</Card.Content>
		<Card.Footer class="justify-center">
			<!-- The dynamic suffix contains only an encoded, sanitized `next` path. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="text-sm underline" href={`${resolve('/login')}${nextQuery}`}>Back to sign in</a>
		</Card.Footer>
	</Card.Root>
</div>
