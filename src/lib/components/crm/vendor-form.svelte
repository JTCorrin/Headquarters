<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { VendorFormData } from '$lib/schemas/vendor.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';

	export interface VendorFormProps {
		form: SuperForm<VendorFormData>;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save vendor',
		class: className,
		onValidSubmit
	}: VendorFormProps = $props();

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
	class={cn('space-y-4', className)}
	data-testid="vendor-form"
>
	<div class="space-y-2">
		<Label for="vendor-name">Name</Label>
		<Input
			id="vendor-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Cloudflare"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
