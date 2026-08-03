<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MeetingFormData } from '$lib/schemas/meeting.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	export interface MeetingFormProps {
		form: SuperForm<MeetingFormData>;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save meeting',
		class: className,
		onValidSubmit
	}: MeetingFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let submitLock = false;
	let pendingSubmit = $state(false);

	const statusOptions = [
		{ value: 'scheduled', label: 'Scheduled' },
		{ value: 'in_progress', label: 'In progress' },
		{ value: 'completed', label: 'Completed' },
		{ value: 'cancelled', label: 'Cancelled' }
	] as const;

	const relatedTypeOptions = [
		{ value: 'none', label: 'None' },
		{ value: 'client', label: 'Client' },
		{ value: 'contact', label: 'Contact' },
		{ value: 'lead', label: 'Lead' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
	const relatedTypeLabel = $derived(
		relatedTypeOptions.find((o) => o.value === $formData.relatedEntityType)?.label ?? 'None'
	);

	function addAttendee() {
		formData.update((current) => ({
			...current,
			attendees: [...(current.attendees ?? []), { email: '', name: '', organiser: false }]
		}));
	}

	function removeAttendee(index: number) {
		formData.update((current) => ({
			...current,
			attendees: (current.attendees ?? []).filter((_, i) => i !== index)
		}));
	}
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
	data-testid="meeting-form"
>
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
		<Label for="meeting-timezone">Timezone</Label>
		<Input
			id="meeting-timezone"
			name="timezone"
			bind:value={$formData.timezone}
			placeholder="Europe/London"
			aria-invalid={!!$errors.timezone}
		/>
		{#if $errors.timezone}<p class="text-destructive text-xs">{$errors.timezone}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="meeting-location">Location</Label>
			<Input
				id="meeting-location"
				name="location"
				bind:value={$formData.location}
				placeholder="Office / room"
			/>
		</div>
		<div class="space-y-2">
			<Label for="meeting-url">Meeting URL</Label>
			<Input
				id="meeting-url"
				name="meetingUrl"
				bind:value={$formData.meetingUrl}
				placeholder="https://…"
			/>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="meeting-related-type">Related to</Label>
			<Select.Root type="single" bind:value={$formData.relatedEntityType} name="relatedEntityType">
				<Select.Trigger id="meeting-related-type" class="w-full">{relatedTypeLabel}</Select.Trigger>
				<Select.Content>
				{#each relatedTypeOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
			{#if $errors.relatedEntityType}
				<p class="text-destructive text-xs">{$errors.relatedEntityType}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="meeting-related-id">Related entity id</Label>
			<Input
				id="meeting-related-id"
				name="relatedEntityId"
				bind:value={$formData.relatedEntityId}
				placeholder="UUID (optional)"
				disabled={$formData.relatedEntityType === 'none'}
				aria-invalid={!!$errors.relatedEntityId}
			/>
			{#if $errors.relatedEntityId}
				<p class="text-destructive text-xs">{$errors.relatedEntityId}</p>
			{/if}
		</div>
	</div>

	<div class="space-y-3">
		<div class="flex items-center justify-between gap-2">
			<Label>Attendees</Label>
			<Button type="button" variant="outline" size="sm" onclick={addAttendee}>
				<PlusIcon class="size-3.5" />
				Add
			</Button>
		</div>
		{#if ($formData.attendees ?? []).length === 0}
			<p class="text-muted-foreground text-xs">Add guests by email. Contact pickers come later.</p>
		{/if}
		{#each $formData.attendees ?? [] as _, index (index)}
			<div class="space-y-2 rounded-xl border p-3">
				<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
					<div class="space-y-1">
						<Label for={`meeting-attendee-email-${index}`} class="text-xs">Email</Label>
						<Input
							id={`meeting-attendee-email-${index}`}
							bind:value={$formData.attendees[index].email}
							placeholder="ava@northwind.com"
							type="email"
						/>
					</div>
					<div class="space-y-1">
						<Label for={`meeting-attendee-name-${index}`} class="text-xs">Name</Label>
						<Input
							id={`meeting-attendee-name-${index}`}
							bind:value={$formData.attendees[index].name}
							placeholder="Ava Chen"
						/>
					</div>
					<div class="flex items-end">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => removeAttendee(index)}
							aria-label="Remove attendee"
						>
							<TrashIcon class="size-3.5" />
						</Button>
					</div>
				</div>
				<label
					class="text-muted-foreground flex items-center gap-2 text-xs"
					for={`meeting-attendee-organiser-${index}`}
				>
					<Checkbox
						id={`meeting-attendee-organiser-${index}`}
						checked={Boolean($formData.attendees[index].organiser)}
						onCheckedChange={(value) => {
							formData.update((current) => {
								const next = [...(current.attendees ?? [])];
								const row = next[index];
								if (!row) return current;
								next[index] = { ...row, organiser: !!value };
								return { ...current, attendees: next };
							});
						}}
					/>
					Organiser
				</label>
			</div>
		{/each}
		{#if $errors.attendees}
			<p class="text-destructive text-xs">Check attendee emails.</p>
		{/if}
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

	<Button type="submit" disabled={$submitting || pendingSubmit}>{submitLabel}</Button>
</form>
