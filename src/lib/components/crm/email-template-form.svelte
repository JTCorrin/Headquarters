<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { EmailTemplateFormData } from '$lib/schemas/email-template.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface EmailTemplateFormProps {
		form: SuperForm<EmailTemplateFormData>;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save template',
		class: className,
		onValidSubmit
	}: EmailTemplateFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);
	let submitLock = false;
	let pendingSubmit = $state(false);

	const categoryOptions = [
		{ value: 'transactional', label: 'Transactional' },
		{ value: 'campaign', label: 'Campaign' },
		{ value: 'chase', label: 'Chase / reminder' },
		{ value: 'onboarding', label: 'Onboarding' },
		{ value: 'other', label: 'Other' }
	] as const;
	const statusOptions = [
		{ value: 'draft', label: 'Draft' },
		{ value: 'active', label: 'Active' },
		{ value: 'archived', label: 'Archived' }
	] as const;

	const categoryLabel = $derived(
		categoryOptions.find((o) => o.value === $formData.category)?.label ?? 'Category'
	);
	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.status)?.label ?? 'Status'
	);
</script>

<form
	method="POST"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			if (!onValidSubmit) return;
			if (submitLock) return false;
			submitLock = true;
			pendingSubmit = true;
			try {
				return await onValidSubmit();
			} catch {
				return false;
			} finally {
				submitLock = false;
				pendingSubmit = false;
			}
		}
	}}
	class={cn('space-y-4', className)}
	data-testid="email-template-form"
>
	<div class="space-y-2">
		<Label for="tpl-name">Name</Label>
		<Input
			id="tpl-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Invoice chase #1"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="tpl-category">Category</Label>
			<Select.Root type="single" bind:value={$formData.category} name="category">
				<Select.Trigger id="tpl-category" class="w-full">{categoryLabel}</Select.Trigger>
				<Select.Content>
					{#each categoryOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="tpl-status">Status</Label>
			<Select.Root type="single" bind:value={$formData.status} name="status">
				<Select.Trigger id="tpl-status" class="w-full">{statusLabel}</Select.Trigger>
				<Select.Content>
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="space-y-2">
		<Label for="tpl-subject">Subject</Label>
		<Input
			id="tpl-subject"
			name="subject"
			bind:value={$formData.subject}
			placeholder={'Quick nudge on {{invoice.number}}'}
			aria-invalid={!!$errors.subject}
		/>
		{#if $errors.subject}<p class="text-destructive text-xs">{$errors.subject}</p>{/if}
		<p class="text-muted-foreground text-xs">
			Variables: {'{{contact.name}}'}, {'{{client.name}}'}, {'{{invoice.number}}'}, {'{{quote.number}}'}
		</p>
	</div>

	<div class="space-y-2">
		<Label for="tpl-body">Body</Label>
		<Textarea
			id="tpl-body"
			name="body"
			bind:value={$formData.body}
			rows={10}
			placeholder={'Hi {{contact.name}}, …'}
			aria-invalid={!!$errors.body}
			class="min-h-48 font-mono text-sm"
		/>
		{#if $errors.body}<p class="text-destructive text-xs">{$errors.body}</p>{/if}
	</div>

	<Button type="submit" disabled={$submitting || pendingSubmit}>{submitLabel}</Button>
</form>
