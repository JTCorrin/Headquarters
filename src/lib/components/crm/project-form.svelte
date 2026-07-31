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
		class?: string;
	}

	let {
		form,
		clients = [],
		submitLabel = 'Save project',
		class: className
	}: ProjectFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	const statusOptions = [
		{ value: 'planning', label: 'Planning' },
		{ value: 'active', label: 'Active' },
		{ value: 'blocked', label: 'Blocked' },
		{ value: 'done', label: 'Done' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
	const clientLabel = $derived(
		clients.find((c) => c.id === $formData.clientId)?.name ?? 'Select client'
	);
</script>

<form method="POST" use:enhance class={cn('space-y-4', className)}>
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

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="project-owner">Owner</Label>
			<Input id="project-owner" name="owner" bind:value={$formData.owner} placeholder="Joe" />
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

	<Button type="submit" disabled={$submitting}>{submitLabel}</Button>
</form>
