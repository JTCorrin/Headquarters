<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { LeadFormData } from '$lib/schemas/lead.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface LeadFormProps {
		form: SuperForm<LeadFormData>;
		submitLabel?: string;
		/** Hide stage when editing a converted (won) lead elsewhere. */
		disableStage?: boolean;
		/** Fired only after Superforms client validation succeeds. */
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		class?: string;
	}

	let {
		form,
		submitLabel = 'Save lead',
		disableStage = false,
		onValidSubmit,
		class: className
	}: LeadFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const stageOptions = [
		{ value: 'new', label: 'New' },
		{ value: 'qualified', label: 'Qualified' },
		{ value: 'proposal', label: 'Proposal' },
		{ value: 'lost', label: 'Lost' }
	] as const;

	const currencyOptions = ['GBP', 'USD', 'EUR'] as const;

	const stageLabel = $derived(
		stageOptions.find((o) => o.value === $formData.stage)?.label ?? 'Stage'
	);
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="lead-form"
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
>
	<div class="space-y-2">
		<Label for="lead-name">Name</Label>
		<Input
			id="lead-name"
			name="name"
			bind:value={$formData.name}
			placeholder="Contoso expansion"
			aria-invalid={!!$errors.name}
		/>
		{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label for="lead-company">Company</Label>
		<Input
			id="lead-company"
			name="companyName"
			bind:value={$formData.companyName}
			placeholder="Contoso"
		/>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="lead-stage">Stage</Label>
			<Select.Root type="single" bind:value={$formData.stage} name="stage" disabled={disableStage}>
				<Select.Trigger id="lead-stage" class="w-full" aria-invalid={!!$errors.stage}>
					{stageLabel}
				</Select.Trigger>
				<Select.Content>
					{#each stageOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-muted-foreground text-[11px]">Won only via Convert lead.</p>
			{#if $errors.stage}<p class="text-destructive text-xs">{$errors.stage}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="lead-currency">Currency</Label>
			<Select.Root type="single" bind:value={$formData.currency} name="currency">
				<Select.Trigger id="lead-currency" class="w-full">{$formData.currency}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as code (code)}
						<Select.Item value={code} label={code}>{code}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if $errors.currency}<p class="text-destructive text-xs">{$errors.currency}</p>{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="lead-value">Value (cents)</Label>
			<Input
				id="lead-value"
				name="valueCents"
				bind:value={$formData.valueCents}
				placeholder="1800000"
				inputmode="numeric"
				aria-invalid={!!$errors.valueCents}
			/>
			{#if $errors.valueCents}<p class="text-destructive text-xs">{$errors.valueCents}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="lead-probability">Probability %</Label>
			<Input
				id="lead-probability"
				name="probabilityPercent"
				bind:value={$formData.probabilityPercent}
				placeholder="60"
				aria-invalid={!!$errors.probabilityPercent}
			/>
			{#if $errors.probabilityPercent}
				<p class="text-destructive text-xs">{$errors.probabilityPercent}</p>
			{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="lead-source">Source</Label>
			<Input id="lead-source" name="source" bind:value={$formData.source} placeholder="Referral" />
		</div>
		<div class="space-y-2">
			<Label for="lead-close">Expected close</Label>
			<Input
				id="lead-close"
				name="expectedCloseOn"
				type="date"
				bind:value={$formData.expectedCloseOn}
				aria-invalid={!!$errors.expectedCloseOn}
			/>
			{#if $errors.expectedCloseOn}
				<p class="text-destructive text-xs">{$errors.expectedCloseOn}</p>
			{/if}
		</div>
	</div>

	{#if $formData.stage === 'lost'}
		<div class="space-y-2">
			<Label for="lead-lost-reason">Lost reason</Label>
			<Textarea
				id="lead-lost-reason"
				name="lostReason"
				bind:value={$formData.lostReason}
				rows={3}
				placeholder="Required when marking lost"
				aria-invalid={!!$errors.lostReason}
			/>
			{#if $errors.lostReason}<p class="text-destructive text-xs">{$errors.lostReason}</p>{/if}
		</div>
	{/if}

	<div class="space-y-2">
		<Label for="lead-notes">Notes</Label>
		<Textarea id="lead-notes" name="notes" bind:value={$formData.notes} rows={3} />
	</div>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
