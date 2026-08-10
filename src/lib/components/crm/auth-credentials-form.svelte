<script lang="ts">
	import { untrack } from 'svelte';
	import { fromAction } from 'svelte/attachments';
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
		showDisplayName?: boolean;
		/** HTML autocomplete for the password field. */
		passwordAutocomplete?: 'current-password' | 'new-password';
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel,
		errorMessage = null,
		showDisplayName = false,
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
	const enhancedForm = fromAction(enhance, () => ({
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
	}));
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="auth-credentials-form"
	{@attach enhancedForm}
>
	{#if errorMessage}
		<p class="text-sm text-destructive" role="alert" data-testid="auth-form-error">
			{errorMessage}
		</p>
	{/if}

	{#if showDisplayName}
		<div class="space-y-2">
			<Label for="auth-display-name">Display name</Label>
			<Input
				id="auth-display-name"
				name="displayName"
				type="text"
				autocomplete="name"
				required
				bind:value={$formData.displayName}
				aria-invalid={!!$errors.displayName}
				data-testid="auth-display-name"
			/>
			{#if $errors.displayName}
				<p class="text-xs text-destructive">{$errors.displayName}</p>
			{/if}
		</div>
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
		{#if $errors.email}<p class="text-xs text-destructive">{$errors.email}</p>{/if}
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
		{#if $errors.password}<p class="text-xs text-destructive">{$errors.password}</p>{/if}
	</div>

	<Button type="submit" class="w-full" disabled={busy} data-testid="auth-submit">
		{busy ? 'Working…' : submitLabel}
	</Button>
</form>
