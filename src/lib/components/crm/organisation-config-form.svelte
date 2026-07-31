<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		themeOptions,
		type OrganisationConfigData
	} from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface OrganisationConfigFormProps {
		form: SuperForm<OrganisationConfigData>;
		readonly?: boolean;
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
		readonly = false,
		submitLabel = 'Save configuration',
		class: className,
		onValidSubmit
	}: OrganisationConfigFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	const busy = $derived($submitting || pendingSubmit);

	const themeLabel = $derived(
		themeOptions.find((t) => t === $formData.themeDefault)?.replace(/^./, (c) => c.toUpperCase()) ??
			'Theme'
	);
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="organisation-config-form"
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
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="org-config-timezone">Timezone</Label>
			<Input
				id="org-config-timezone"
				name="timezone"
				bind:value={$formData.timezone}
				disabled={readonly || busy}
				aria-invalid={!!$errors.timezone}
			/>
			{#if $errors.timezone}<p class="text-destructive text-xs">{$errors.timezone}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-config-currency">Default currency</Label>
			<Input
				id="org-config-currency"
				name="currency"
				bind:value={$formData.currency}
				disabled={readonly || busy}
				aria-invalid={!!$errors.currency}
			/>
			{#if $errors.currency}<p class="text-destructive text-xs">{$errors.currency}</p>{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="org-config-locale">Locale</Label>
			<Input
				id="org-config-locale"
				name="locale"
				bind:value={$formData.locale}
				disabled={readonly || busy}
				aria-invalid={!!$errors.locale}
			/>
			{#if $errors.locale}<p class="text-destructive text-xs">{$errors.locale}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-config-theme">Organisation theme</Label>
			{#if readonly}
				<Input id="org-config-theme" value={themeLabel} disabled />
			{:else}
				<Select.Root type="single" bind:value={$formData.themeDefault} name="themeDefault" disabled={busy}>
					<Select.Trigger id="org-config-theme" class="w-full" disabled={busy}>{themeLabel}</Select.Trigger>
					<Select.Content>
						{#each themeOptions as option (option)}
							<Select.Item value={option} label={option}>{option}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
		</div>
	</div>

	{#if !readonly}
		<div class="flex justify-end">
			<Button type="submit" disabled={busy} data-testid="organisation-config-submit">
				{busy ? 'Saving…' : submitLabel}
			</Button>
		</div>
	{/if}
</form>
