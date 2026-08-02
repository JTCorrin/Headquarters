<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ContactFormData } from '$lib/schemas/contact.js';
	import type { LeadClientOption } from '$lib/schemas/lead.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import ClientPicker from './client-picker.svelte';
	import { cn } from '$lib/utils.js';

	export interface ContactFormProps {
		form: SuperForm<ContactFormData>;
		clientOptions?: LeadClientOption[];
		submitLabel?: string;
		class?: string;
		/**
		 * Called after client-side validation succeeds.
		 * Return `false` (or reject) to signal failure; may be async.
		 */
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onCreateClient?: () => void;
	}

	let {
		form,
		clientOptions = [],
		submitLabel = 'Save contact',
		class: className,
		onValidSubmit,
		onCreateClient
	}: ContactFormProps = $props();

	// SuperForm instance is stable; stores inside are the reactive surface.
	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const statusOptions = [
		{ value: 'active', label: 'Active' },
		{ value: 'inactive', label: 'Inactive' },
		{ value: 'archived', label: 'Archived' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Select status'
	);
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
	class={cn('max-w-lg space-y-4', className)}
	data-testid="contact-form"
>
	<div class="space-y-2">
		<Label for="contact-name">Name</Label>
		<Input
			id="contact-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Ava Chen"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="contact-client-picker">Client</Label>
		<input type="hidden" name="clientId" value={$formData.clientId ?? ''} />
		<ClientPicker
			id="contact-client-picker"
			value={$formData.clientId ?? ''}
			options={clientOptions}
			placeholder="Select client (optional)"
			aria-invalid={!!$errors.clientId}
			onValueChange={(id) => {
				$formData.clientId = id;
			}}
			onCreateNew={onCreateClient}
		/>
		<p class="text-muted-foreground text-[11px]">
			Links via the primary client relationship — not a contact column.
		</p>
		{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="contact-email">Email</Label>
		<Input
			id="contact-email"
			name="email"
			type="email"
			bind:value={$formData.email}
			placeholder="ava@northwind.com"
			aria-invalid={!!$errors.email}
		/>
		{#if $errors.email}<p class="text-destructive text-xs">{$errors.email}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="contact-phone">Phone</Label>
			<Input id="contact-phone" name="phone" bind:value={$formData.phone} placeholder="+44 …" />
			{#if $errors.phone}<p class="text-destructive text-xs">{$errors.phone}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="contact-company">Company</Label>
			<Input
				id="contact-company"
				name="company"
				bind:value={$formData.company}
				placeholder="Northwind"
			/>
			{#if $errors.company}<p class="text-destructive text-xs">{$errors.company}</p>{/if}
		</div>
	</div>

	<div class="space-y-2">
		<Label for="contact-title">Title</Label>
		<Input
			id="contact-title"
			name="title"
			bind:value={$formData.title}
			placeholder="Head of Operations"
		/>
		{#if $errors.title}<p class="text-destructive text-xs">{$errors.title}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="contact-status">Status</Label>
		<Select.Root type="single" bind:value={$formData.status} name="status">
			<Select.Trigger id="contact-status" class="w-full" aria-invalid={!!$errors.status}>
				{statusLabel}
			</Select.Trigger>
			<Select.Content>
				{#each statusOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if $errors.status}<p class="text-destructive text-xs">{$errors.status}</p>{/if}
	</div>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
