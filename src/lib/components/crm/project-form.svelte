<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProjectFormData } from '$lib/schemas/project.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProjectClientOption {
		id: string;
		name: string;
	}

	export interface ProjectFormProps {
		form: SuperForm<ProjectFormData>;
		clients?: ProjectClientOption[];
		submitLabel?: string;
		/** When true, status select includes Archive. */
		allowArchived?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		clients = [],
		submitLabel = 'Save project',
		allowArchived = false,
		class: className,
		onValidSubmit
	}: ProjectFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let submitLock = false;
	let pendingSubmit = $state(false);

	const statusOptions = $derived([
		{ value: 'planning', label: 'Planning' },
		{ value: 'active', label: 'Active' },
		{ value: 'blocked', label: 'Blocked' },
		{ value: 'done', label: 'Done' },
		...(allowArchived ? [{ value: 'archived', label: 'Archived' }] : [])
	]);

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
	const clientLabel = $derived(
		clients.find((c) => c.id === $formData.clientId)?.name ?? 'Select client'
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
	class={cn('space-y-4', className)}
	data-testid="project-form"
>
	<div class="space-y-2">
		<Label for="project-name">Name</Label>
		<Input
			id="project-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Q2 retainer delivery"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="project-client">Client</Label>
		<Select.Root type="single" bind:value={$formData.clientId} name="clientId">
			<Select.Trigger id="project-client" class="w-full" aria-invalid={!!$errors.clientId}>
				{clientLabel}
			</Select.Trigger>
			<Select.Content>
				{#each clients as client (client.id)}
					<Select.Item value={client.id} label={client.name}>{client.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="project-status">Status</Label>
		<Select.Root type="single" bind:value={$formData.status} name="status">
			<Select.Trigger id="project-status" class="w-full">{statusLabel}</Select.Trigger>
			<Select.Content>
				{#each statusOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="space-y-2">
		<Label for="project-description">Description</Label>
		<Textarea
			id="project-description"
			name="description"
			bind:value={$formData.description}
			placeholder="Optional scope notes"
			rows={3}
		/>
	</div>

	<Button type="submit" disabled={$submitting || pendingSubmit}>{submitLabel}</Button>
</form>
