<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		themePreferenceOptions,
		type ProfilePreferencesData
	} from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProfilePreferencesFormProps {
		form: SuperForm<ProfilePreferencesData>;
		submitLabel?: string;
		class?: string;
		/**
		 * Called after client-side validation succeeds.
		 * May return a Promise; awaited before ending pending state.
		 */
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save preference',
		class: className,
		onValidSubmit
	}: ProfilePreferencesFormProps = $props();

	const formData = untrack(() => form.form);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	const busy = $derived($submitting || pendingSubmit);

	const labels: Record<(typeof themePreferenceOptions)[number], string> = {
		system: 'System',
		light: 'Light',
		dark: 'Dark',
		org_default: 'Use organisation default'
	};

	const themeLabel = $derived(labels[$formData.themePreference] ?? 'Theme');
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="profile-preferences-form"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			pendingSubmit = true;
			try {
				return await onValidSubmit?.();
			} catch {
				// Swallow so Superforms default onError does not rethrow.
				return false;
			} finally {
				pendingSubmit = false;
			}
		}
	}}
>
	<div class="space-y-2">
		<Label for="profile-theme">Personal theme</Label>
		<Select.Root
			type="single"
			bind:value={$formData.themePreference}
			name="themePreference"
			disabled={busy}
		>
			<Select.Trigger
				id="profile-theme"
				class="w-full"
				data-testid="profile-theme-trigger"
				disabled={busy}
			>
				{themeLabel}
			</Select.Trigger>
			<Select.Content>
				{#each themePreferenceOptions as option (option)}
					<Select.Item value={option} label={labels[option]}>{labels[option]}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-muted-foreground text-xs">
			Overrides the organisation default for your account across every org.
		</p>
	</div>

	<div class="flex justify-end">
		<Button type="submit" disabled={busy} data-testid="profile-preferences-submit">
			{busy ? 'Saving…' : submitLabel}
		</Button>
	</div>
</form>
