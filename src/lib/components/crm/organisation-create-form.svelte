<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		slugifyOrganisationName,
		type OrganisationCreateData
	} from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';

	export interface OrganisationCreateFormProps {
		form: SuperForm<OrganisationCreateData>;
		submitLabel?: string;
		class?: string;
		/**
		 * Called after client-side validation succeeds.
		 * May return a Promise; awaited before ending pending state.
		 * Return `false` or reject to signal failure (drawer stays open).
		 */
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Create organisation',
		class: className,
		onValidSubmit
	}: OrganisationCreateFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let slugTouched = $state(false);
	/** Tracks awaited create work so the button stays disabled if Superforms clears submitting early. */
	let pendingSubmit = $state(false);
	const busy = $derived($submitting || pendingSubmit);

	function onNameInput(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		$formData.name = value;
		if (!slugTouched) {
			$formData.slug = slugifyOrganisationName(value);
		}
	}
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="organisation-create-form"
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
		<Label for="org-create-name">Name</Label>
		<Input
			id="org-create-name"
			name="name"
			value={$formData.name}
			oninput={onNameInput}
			placeholder="Corrin Data"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="org-create-slug">Slug</Label>
		<Input
			id="org-create-slug"
			name="slug"
			bind:value={$formData.slug}
			oninput={() => {
				slugTouched = true;
			}}
			placeholder="corrin-data"
			aria-invalid={!!$errors.slug}
		/>
		{#if $errors.slug}<p class="text-destructive text-xs">{$errors.slug}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="org-create-timezone">Timezone</Label>
			<Input
				id="org-create-timezone"
				name="timezone"
				bind:value={$formData.timezone}
				placeholder="Europe/London"
				aria-invalid={!!$errors.timezone}
			/>
			{#if $errors.timezone}<p class="text-destructive text-xs">{$errors.timezone}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-create-currency">Currency</Label>
			<Input
				id="org-create-currency"
				name="currency"
				bind:value={$formData.currency}
				placeholder="GBP"
				aria-invalid={!!$errors.currency}
			/>
			{#if $errors.currency}<p class="text-destructive text-xs">{$errors.currency}</p>{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="org-create-locale">Locale</Label>
			<Input
				id="org-create-locale"
				name="locale"
				bind:value={$formData.locale}
				placeholder="en-GB"
				aria-invalid={!!$errors.locale}
			/>
			{#if $errors.locale}<p class="text-destructive text-xs">{$errors.locale}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-create-country">Country</Label>
			<Input
				id="org-create-country"
				name="country"
				bind:value={$formData.country}
				placeholder="GB"
				aria-invalid={!!$errors.country}
			/>
			{#if $errors.country}<p class="text-destructive text-xs">{$errors.country}</p>{/if}
		</div>
	</div>

	<div class="flex justify-end">
		<Button type="submit" disabled={busy} data-testid="organisation-create-submit">
			{busy ? 'Creating…' : submitLabel}
		</Button>
	</div>
</form>
