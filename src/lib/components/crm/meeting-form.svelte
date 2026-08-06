<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MeetingFormData } from '$lib/schemas/meeting.js';
	import type { NamedEntityOption } from './named-entity-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import DateField from './date-field.svelte';
	import NamedEntityPicker from './named-entity-picker.svelte';
	import { cn } from '$lib/utils.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	export interface MeetingFormProps {
		form: SuperForm<MeetingFormData>;
		submitLabel?: string;
		class?: string;
		relatedEntityOptions?: NamedEntityOption[];
		relatedEntityLoading?: boolean;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onRelatedEntityTypeChange?: (type: MeetingFormData['relatedEntityType']) => void;
	}

	let {
		form,
		submitLabel = 'Save meeting',
		class: className,
		relatedEntityOptions = [],
		relatedEntityLoading = false,
		onValidSubmit,
		onRelatedEntityTypeChange
	}: MeetingFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let submitLock = false;
	let pendingSubmit = $state(false);
	let startsDateLocal = $state('');
	let endsDateLocal = $state('');
	let lastStartsFromForm = $state('');
	let lastEndsFromForm = $state('');

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
		{ value: 'lead', label: 'Lead' },
		{ value: 'project', label: 'Project' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
	const relatedTypeLabel = $derived(
		relatedTypeOptions.find((o) => o.value === $formData.relatedEntityType)?.label ?? 'None'
	);
	const startsTime = $derived(splitLocalDatetime($formData.startsAt).time);
	const endsTime = $derived(splitLocalDatetime($formData.endsAt).time);

	const relatedPlaceholder = $derived(
		$formData.relatedEntityType === 'client'
			? 'Select client'
			: $formData.relatedEntityType === 'contact'
				? 'Select contact'
				: $formData.relatedEntityType === 'lead'
					? 'Select lead'
					: $formData.relatedEntityType === 'project'
						? 'Select project'
						: 'Select…'
	);

	function splitLocalDatetime(value: string): { date: string; time: string } {
		const trimmed = value?.trim() ?? '';
		if (!trimmed) return { date: '', time: '' };
		const [datePart, timePart = ''] = trimmed.split('T');
		return { date: datePart ?? '', time: timePart.slice(0, 5) };
	}

	function joinLocalDatetime(date: string, time: string): string {
		const d = date.trim();
		if (!d) return '';
		const t = time.trim() || '09:00';
		return `${d}T${t}`;
	}

	function setStartsFromParts(date: string, time: string) {
		formData.update((current) => ({
			...current,
			startsAt: joinLocalDatetime(date, time || splitLocalDatetime(current.startsAt).time || '09:00')
		}));
	}

	function setEndsFromParts(date: string, time: string) {
		formData.update((current) => ({
			...current,
			endsAt: joinLocalDatetime(date, time || splitLocalDatetime(current.endsAt).time || '10:00')
		}));
	}

	$effect(() => {
		const fromForm = splitLocalDatetime($formData.startsAt).date;
		if (fromForm !== lastStartsFromForm) {
			lastStartsFromForm = fromForm;
			startsDateLocal = fromForm;
		}
	});

	$effect(() => {
		const fromForm = splitLocalDatetime($formData.endsAt).date;
		if (fromForm !== lastEndsFromForm) {
			lastEndsFromForm = fromForm;
			endsDateLocal = fromForm;
		}
	});

	$effect(() => {
		const date = startsDateLocal;
		const current = splitLocalDatetime($formData.startsAt);
		if (date === current.date) return;
		setStartsFromParts(date, current.time || '09:00');
	});

	$effect(() => {
		const date = endsDateLocal;
		const current = splitLocalDatetime($formData.endsAt);
		if (date === current.date) return;
		setEndsFromParts(date, current.time || '10:00');
	});

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
			<Label for="meeting-start-date">Starts</Label>
			<input type="hidden" name="startsAt" value={$formData.startsAt} />
			<DateField
				id="meeting-start-date"
				bind:value={startsDateLocal}
				aria-invalid={!!$errors.startsAt}
				data-testid="meeting-start-date"
			/>
			<Input
				id="meeting-start-time"
				type="time"
				value={startsTime}
				aria-label="Start time"
				data-testid="meeting-start-time"
				oninput={(e) =>
					setStartsFromParts(startsDateLocal, (e.currentTarget as HTMLInputElement).value)}
			/>
			{#if $errors.startsAt}<p class="text-destructive text-xs">{$errors.startsAt}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="meeting-end-date">Ends</Label>
			<input type="hidden" name="endsAt" value={$formData.endsAt} />
			<DateField
				id="meeting-end-date"
				bind:value={endsDateLocal}
				aria-invalid={!!$errors.endsAt}
				data-testid="meeting-end-date"
			/>
			<Input
				id="meeting-end-time"
				type="time"
				value={endsTime}
				aria-label="End time"
				data-testid="meeting-end-time"
				oninput={(e) =>
					setEndsFromParts(endsDateLocal, (e.currentTarget as HTMLInputElement).value)}
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
			<Select.Root
				type="single"
				value={$formData.relatedEntityType}
				name="relatedEntityType"
				onValueChange={(next) => {
					const value = (next ?? 'none') as MeetingFormData['relatedEntityType'];
					formData.update((current) => ({
						...current,
						relatedEntityType: value,
						relatedEntityId: value === 'none' ? '' : ''
					}));
					onRelatedEntityTypeChange?.(value);
				}}
			>
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
			<Label for="meeting-related-id">
				{$formData.relatedEntityType === 'none' ? 'Related record' : relatedTypeLabel}
			</Label>
			{#if $formData.relatedEntityType === 'none'}
				<Input
					id="meeting-related-id"
					name="relatedEntityId"
					value=""
					placeholder="Choose a type first"
					disabled
				/>
			{:else}
				<NamedEntityPicker
					id="meeting-related-id"
					value={$formData.relatedEntityId}
					options={relatedEntityOptions}
					loading={relatedEntityLoading}
					placeholder={relatedPlaceholder}
					emptyMessage={`No ${relatedTypeLabel.toLowerCase()}s found.`}
					aria-invalid={!!$errors.relatedEntityId}
					data-testid="meeting-related-picker"
					onValueChange={(id) => {
						formData.update((current) => ({ ...current, relatedEntityId: id }));
					}}
				/>
			{/if}
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
