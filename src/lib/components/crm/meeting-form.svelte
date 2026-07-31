<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MeetingFormData } from '$lib/schemas/meeting.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface MeetingFormProps {
		form: SuperForm<MeetingFormData>;
		submitLabel?: string;
		class?: string;
	}

	let { form, submitLabel = 'Save meeting', class: className }: MeetingFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	const statusOptions = [
		{ value: 'scheduled', label: 'Scheduled' },
		{ value: 'completed', label: 'Completed' },
		{ value: 'cancelled', label: 'Cancelled' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
</script>

<form method="POST" use:enhance class={cn('space-y-4', className)}>
	<div class="space-y-2">
		<Label for="meeting-title">Title</Label>
		<Input
			id="meeting-title"
			name="title"
			bind:value={$formData.title}
			placeholder="Q2 planning"
			aria-invalid={!!$errors.title}
		/>
		{#if $errors.title}<p class="text-destructive text-xs">{$errors.title}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="meeting-related">Related to</Label>
		<Input
			id="meeting-related"
			name="relatedTo"
			bind:value={$formData.relatedTo}
			placeholder="Northwind"
		/>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="meeting-start">Starts</Label>
			<Input
				id="meeting-start"
				name="startsAt"
				type="datetime-local"
				bind:value={$formData.startsAt}
				aria-invalid={!!$errors.startsAt}
			/>
			{#if $errors.startsAt}<p class="text-destructive text-xs">{$errors.startsAt}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="meeting-end">Ends</Label>
			<Input
				id="meeting-end"
				name="endsAt"
				type="datetime-local"
				bind:value={$formData.endsAt}
				aria-invalid={!!$errors.endsAt}
			/>
			{#if $errors.endsAt}<p class="text-destructive text-xs">{$errors.endsAt}</p>{/if}
		</div>
	</div>

	<div class="space-y-2">
		<Label for="meeting-attendees">Attendees</Label>
		<Input
			id="meeting-attendees"
			name="attendees"
			bind:value={$formData.attendees}
			placeholder="Ava Chen, Joe"
		/>
	</div>

	<div class="space-y-2">
		<Label for="meeting-status">Status</Label>
		<Select.Root type="single" bind:value={$formData.status} name="status">
			<Select.Trigger id="meeting-status" class="w-full">{statusLabel}</Select.Trigger>
			<Select.Content>
				{#each statusOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<Button type="submit" disabled={$submitting}>{submitLabel}</Button>
</form>
