<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { DocumentFormData } from '$lib/schemas/document.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface DocumentFormProps {
		form: SuperForm<DocumentFormData>;
		submitLabel?: string;
		class?: string;
	}

	let { form, submitLabel = 'Attach document', class: className }: DocumentFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	const categoryOptions = [
		{ value: 'contract', label: 'Contract' },
		{ value: 'proposal', label: 'Proposal' },
		{ value: 'invoice', label: 'Invoice / bill PDF' },
		{ value: 'receipt', label: 'Receipt' },
		{ value: 'other', label: 'Other' }
	] as const;

	const categoryLabel = $derived(
		categoryOptions.find((o) => o.value === $formData.category)?.label ?? 'Category'
	);
</script>

<form method="POST" use:enhance class={cn('space-y-4', className)}>
	<div class="space-y-2">
		<Label for="document-name">Name</Label>
		<Input
			id="document-name"
			name="name"
			bind:value={$formData.name}
			placeholder="MSA — Northwind.pdf"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="document-category">Category</Label>
		<Select.Root type="single" bind:value={$formData.category} name="category">
			<Select.Trigger id="document-category" class="w-full" aria-invalid={!!$errors.category}>
				{categoryLabel}
			</Select.Trigger>
			<Select.Content>
				{#each categoryOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if $errors.category}<p class="text-destructive text-xs">{$errors.category}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="document-notes">Notes</Label>
		<Input
			id="document-notes"
			name="notes"
			bind:value={$formData.notes}
			placeholder="Optional context"
			aria-invalid={!!$errors.notes}
		/>
		{#if $errors.notes}<p class="text-destructive text-xs">{$errors.notes}</p>{/if}
	</div>

	<p class="text-muted-foreground text-xs">
		Storybook mock — file picker wires up with storage later.
	</p>

	<Button type="submit" disabled={$submitting} class="w-full sm:w-auto">{submitLabel}</Button>
</form>
