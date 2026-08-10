<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getAuthSession, safeNextPath } from '$lib/auth/index.js';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	const auth = getAuthSession();
	const next = $derived(safeNextPath(page.url.searchParams.get('next')));
	let password = $state('');
	let confirmation = $state('');
	let pending = $state(false);
	let errorMessage = $state<string | null>(null);

	async function updatePassword(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		errorMessage = null;
		if (password.length < 8) {
			errorMessage = 'Password must be at least 8 characters';
			return;
		}
		if (password.length > 72) {
			errorMessage = 'Password must be at most 72 characters';
			return;
		}
		if (password !== confirmation) {
			errorMessage = 'Passwords do not match';
			return;
		}

		pending = true;
		try {
			const result = await auth.updatePassword(password);
			if (result.error) {
				errorMessage = result.error;
				return;
			}
			// `next` is runtime data, but safeNextPath has restricted it to this origin.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(next);
		} catch {
			errorMessage = 'Could not update password';
		} finally {
			pending = false;
		}
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader title="Choose a new password" description="Use at least 8 characters." />
	<Card.Root>
		<Card.Header>
			<Card.Title>Update password</Card.Title>
			<Card.Description>Your new password will replace the one you used before.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form class="space-y-4" onsubmit={updatePassword}>
				{#if errorMessage}
					<p class="text-sm text-destructive" role="alert">{errorMessage}</p>
				{/if}
				<div class="space-y-2">
					<Label for="new-password">New password</Label>
					<Input
						id="new-password"
						name="password"
						type="password"
						autocomplete="new-password"
						required
						minlength={8}
						maxlength={72}
						bind:value={password}
					/>
				</div>
				<div class="space-y-2">
					<Label for="confirm-password">Confirm new password</Label>
					<Input
						id="confirm-password"
						name="confirmation"
						type="password"
						autocomplete="new-password"
						required
						minlength={8}
						maxlength={72}
						bind:value={confirmation}
					/>
				</div>
				<Button type="submit" class="w-full" disabled={pending || !auth.session}>
					{pending ? 'Updating…' : 'Update password'}
				</Button>
				{#if !auth.session}
					<p class="text-sm text-muted-foreground">
						Open the password reset link from your email before choosing a new password.
					</p>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>
</div>
