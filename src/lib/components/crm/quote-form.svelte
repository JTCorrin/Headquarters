<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { QuoteClientOption, QuoteFormData } from '$lib/schemas/quote.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface QuoteFormProps {
		form: SuperForm<QuoteFormData>;
		submitLabel?: string;
		clientOptions?: QuoteClientOption[];
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		submitLabel = 'Save quote',
		clientOptions = [],
		class: className,
		onValidSubmit
	}: QuoteFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit);

	const currencyOptions = [
		{ value: 'GBP', label: 'GBP' },
		{ value: 'USD', label: 'USD' },
		{ value: 'EUR', label: 'EUR' }
	] as const;
	const statusLabels: Record<string, string> = {
		draft: 'Draft',
		sent: 'Sent',
		accepted: 'Accepted',
		rejected: 'Rejected',
		expired: 'Expired',
		void: 'Void'
	};

	const currencyLabel = $derived(
		currencyOptions.find((o) => o.value === $formData.currency)?.label ?? 'Currency'
	);
	const statusLabel = $derived(statusLabels[$formData.status] ?? 'Draft');
	const clientLabel = $derived(
		clientOptions.find((o) => o.id === $formData.clientId)?.name ??
			($formData.clientName || 'Select client')
	);
	const useClientSelect = $derived(clientOptions.length > 0);

	$effect(() => {
		const selected = clientOptions.find((o) => o.id === $formData.clientId);
		if (selected && $formData.clientName !== selected.name) {
			$formData.clientName = selected.name;
		}
	});
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="quote-form"
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
	{#if useClientSelect}
		<div class="space-y-2">
			<Label for="quote-client">Client</Label>
			<Select.Root type="single" bind:value={$formData.clientId} name="clientId">
				<Select.Trigger id="quote-client" class="w-full" aria-invalid={!!$errors.clientId}>
					{clientLabel}
				</Select.Trigger>
				<Select.Content>
					{#each clientOptions as option (option.id)}
						<Select.Item value={option.id} label={option.name}>{option.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
		</div>
	{:else}
		<div class="space-y-2">
			<Label for="quote-client">Client</Label>
			<Input
				id="quote-client"
				name="clientName"
				bind:value={$formData.clientName}
				placeholder="Northwind"
				aria-invalid={!!$errors.clientName}
			/>
			{#if $errors.clientName}<p class="text-destructive text-xs">{$errors.clientName}</p>{/if}
			{#if $errors.clientId}<p class="text-destructive text-xs">{$errors.clientId}</p>{/if}
		</div>
	{/if}

	<div class="space-y-2">
		<Label for="quote-title">Title</Label>
		<Input
			id="quote-title"
			name="title"
			bind:value={$formData.title}
			placeholder="Q2 retainer"
			aria-invalid={!!$errors.title}
		/>
		{#if $errors.title}<p class="text-destructive text-xs">{$errors.title}</p>{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<Label for="quote-currency">Currency</Label>
			<Select.Root type="single" bind:value={$formData.currency} name="currency">
				<Select.Trigger id="quote-currency" class="w-full">{currencyLabel}</Select.Trigger>
				<Select.Content>
					{#each currencyOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<Label for="quote-status">Status</Label>
			<Input
				id="quote-status"
				name="status"
				value={statusLabel}
				readonly
				disabled
				tabindex={-1}
				class="bg-muted/40"
				data-testid="quote-status-readonly"
				aria-describedby="quote-status-help"
			/>
			<p id="quote-status-help" class="text-muted-foreground text-xs">
				Status is locked — use <span class="font-medium">Accept</span>, then
				<span class="font-medium">Convert to invoice</span>. Saving details does not change status.
			</p>
		</div>
	</div>

	<Button type="submit" disabled={busy}>{submitLabel}</Button>
</form>
