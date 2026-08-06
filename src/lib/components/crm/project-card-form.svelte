<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProjectCardFormData } from '$lib/schemas/project.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import DateField from './date-field.svelte';
	import { cn } from '$lib/utils.js';

	export interface ProjectCardFormProps {
		form: SuperForm<ProjectCardFormData>;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onDelete?: () => void | Promise<void>;
		deleteLabel?: string;
	}

	let {
		form,
		submitLabel = 'Save card',
		class: className,
		onValidSubmit,
		onDelete,
		deleteLabel = 'Delete card'
	}: ProjectCardFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let submitLock = false;
	let pendingSubmit = $state(false);
	let deleteBusy = $state(false);
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
	data-testid="project-card-form"
>
	<div class="space-y-2">
		<Label for="project-card-title">Title</Label>
		<Input
			id="project-card-title"
			name="title"
			bind:value={$formData.title}
			placeholder="Draft kickoff agenda"
			aria-invalid={!!$errors.title}
		/>
		{#if $errors.title}<p class="text-destructive text-xs">{$errors.title}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="project-card-description">Description</Label>
		<Textarea
			id="project-card-description"
			name="description"
			bind:value={$formData.description}
			placeholder="Optional details"
			rows={3}
		/>
	</div>

	<div class="space-y-2">
		<Label for="project-card-due">Due</Label>
		<DateField
			id="project-card-due"
			name="dueAt"
			bind:value={$formData.dueAt}
			presets={['today', 'plus7', 'endOfMonth']}
		/>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit" disabled={$submitting || pendingSubmit || deleteBusy}>
			{submitLabel}
		</Button>
		{#if onDelete}
			<Button
				type="button"
				variant="outline"
				disabled={$submitting || pendingSubmit || deleteBusy}
				onclick={async () => {
					deleteBusy = true;
					try {
						await onDelete();
					} finally {
						deleteBusy = false;
					}
				}}
			>
				{deleteLabel}
			</Button>
		{/if}
	</div>
</form>
