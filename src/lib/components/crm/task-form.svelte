<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { TaskAssigneeOption, TaskFormData } from '$lib/schemas/task.js';
	import { taskPriorities, taskStatuses } from '$lib/schemas/task.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import DateField from './date-field.svelte';
	import { cn } from '$lib/utils.js';

	export interface TaskFormProps {
		form: SuperForm<TaskFormData>;
		assigneeOptions?: TaskAssigneeOption[];
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		assigneeOptions = [],
		submitLabel = 'Save task',
		class: className,
		onValidSubmit
	}: TaskFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const priorityOptions = [
		{ value: 'p1', label: 'P1 — Urgent' },
		{ value: 'p2', label: 'P2 — High' },
		{ value: 'p3', label: 'P3 — Normal' },
		{ value: 'p4', label: 'P4 — Low' }
	] as const;

	const statusOptions = [
		{ value: 'open', label: 'Open' },
		{ value: 'in_progress', label: 'In progress' },
		{ value: 'blocked', label: 'Blocked' },
		{ value: 'done', label: 'Done' },
		{ value: 'cancelled', label: 'Cancelled' }
	] as const;

	const priorityLabel = $derived(
		priorityOptions.find((o) => o.value === $formData.priority)?.label ?? 'Priority'
	);
	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
	const assigneeLabel = $derived(
		$formData.assigneeMembershipId
			? (assigneeOptions.find((o) => o.id === $formData.assigneeMembershipId)?.label ??
				'Assignee')
			: 'Unassigned'
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
	data-testid="task-form"
>
	<div class="space-y-2">
		<Label for="task-title">Title</Label>
		<Input id="task-title" name="title" bind:value={$formData.title} aria-invalid={!!$errors.title} />
		{#if $errors.title}
			<p class="text-destructive text-sm">{$errors.title}</p>
		{/if}
	</div>

	<div class="space-y-2">
		<Label for="task-description">Description</Label>
		<Textarea
			id="task-description"
			name="description"
			rows={3}
			bind:value={$formData.description}
			aria-invalid={!!$errors.description}
		/>
		{#if $errors.description}
			<p class="text-destructive text-sm">{$errors.description}</p>
		{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="task-priority">Priority</Label>
			<Select.Root
				type="single"
				value={$formData.priority}
				onValueChange={(value) => {
					if (value && (taskPriorities as readonly string[]).includes(value)) {
						$formData.priority = value as TaskFormData['priority'];
					}
				}}
			>
				<Select.Trigger id="task-priority" aria-label="Priority">
					{priorityLabel}
				</Select.Trigger>
				<Select.Content>
					{#each priorityOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>
							{option.label}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-2">
			<Label for="task-status">Status</Label>
			<Select.Root
				type="single"
				value={$formData.status}
				onValueChange={(value) => {
					if (value && (taskStatuses as readonly string[]).includes(value)) {
						$formData.status = value as TaskFormData['status'];
					}
				}}
			>
				<Select.Trigger id="task-status" aria-label="Status">
					{statusLabel}
				</Select.Trigger>
				<Select.Content>
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>
							{option.label}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="task-assignee">Assignee</Label>
			<Select.Root
				type="single"
				value={$formData.assigneeMembershipId || 'unassigned'}
				onValueChange={(value) => {
					$formData.assigneeMembershipId = value === 'unassigned' ? '' : (value ?? '');
				}}
			>
				<Select.Trigger id="task-assignee" aria-label="Assignee">
					{assigneeLabel}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="unassigned" label="Unassigned">Unassigned</Select.Item>
					{#each assigneeOptions as option (option.id)}
						<Select.Item value={option.id} label={option.label}>
							{option.label}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-2">
			<Label for="task-due">Due date</Label>
			<DateField
				id="task-due"
				name="dueOn"
				bind:value={$formData.dueOn}
				presets={['today', 'plus7', 'endOfMonth']}
			/>
		</div>
	</div>

	<div class="pt-2">
		<Button type="submit" size="sm" disabled={busy}>
			{submitLabel}
		</Button>
	</div>
</form>
