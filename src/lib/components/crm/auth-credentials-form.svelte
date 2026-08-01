<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { AuthCredentialsData } from '$lib/schemas/auth.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';

	export interface AuthCredentialsFormProps {
		form: SuperForm<AuthCredentialsData>;
		submitLabel: string;
		errorMessage?: string | null;
		/** HTML autocomplete for the password field. */
		passwordAutocomplete?: 'current-password' | 'new-password';
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel,
		errorMessage = null,
		passwordAutocomplete = 'current-password',
		class: className,
		onValidSubmit
	}: AuthCredentialsFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="auth-credentials-form"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			if (submitLock) return false;
			submitLock = true;
			pendingSubmit = true;
			try {
				return await onValidSubmit?.();
			} catch {
				return false;
			} finally {
				submitLock = false;
				pendingSubmit = false;
			}
		}
	}}
>
	{#if errorMessage}
		<p class="text-destructive text-sm" role="alert" data-testid="auth-form-error">
			{errorMessage}
		</p>
	{/if}

	<div class="space-y-2">
		<Label for="auth-email">Email</Label>
		<Input
			id="auth-email"
			name="email"
			type="email"
			autocomplete="email"
			bind:value={$formData.email}
			aria-invalid={!!$errors.email}
			data-testid="auth-email"
		/>
		{#if $errors.email}<p class="text-destructive text-xs">{$errors.email}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="auth-password">Password</Label>
		<Input
			id="auth-password"
			name="password"
			type="password"
			autocomplete={passwordAutocomplete}
			bind:value={$formData.password}
			aria-invalid={!!$errors.password}
			data-testid="auth-password"
		/>
		{#if $errors.password}<p class="text-destructive text-xs">{$errors.password}</p>{/if}
	</div>

	<Button type="submit" class="w-full" disabled={busy} data-testid="auth-submit">
		{busy ? 'Working…' : submitLabel}
	</Button>
</form>
