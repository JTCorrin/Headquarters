<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ConvertLeadFormData } from '$lib/schemas/lead.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface ConvertLeadDialogProps {
		form: SuperForm<ConvertLeadFormData>;
		open?: boolean;
		leadName: string;
		busy?: boolean;
		class?: string;
		onConfirm?: () => void;
	}

	let {
		form,
		open = $bindable(false),
		leadName,
		busy = false,
		class: className,
		onConfirm
	}: ConvertLeadDialogProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);

	const statusOptions = [
		{ value: 'prospect', label: 'Prospect' },
		{ value: 'active', label: 'Active' },
		{ value: 'on_hold', label: 'On hold' },
		{ value: 'inactive', label: 'Inactive' },
		{ value: 'archived', label: 'Archived' }
	] as const;

	const statusLabel = $derived(
		statusOptions.find((o) => o.value === $formData.clientStatus)?.label ?? 'Active (default)'
	);
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	<Drawer.Content class={cn('mx-auto w-full max-w-md', className)} data-testid="convert-lead-dialog">
		<Drawer.Header class="text-left">
			<Drawer.Title>Convert lead</Drawer.Title>
			<Drawer.Description>
				Turn <span class="font-medium text-foreground">{leadName}</span> into a client. Repeat
				calls are idempotent.
			</Drawer.Description>
		</Drawer.Header>
		<form
			class="space-y-4 px-4 pb-2"
			onsubmit={(e) => {
				e.preventDefault();
				onConfirm?.();
			}}
		>
			<div class="space-y-2">
				<Label for="convert-client-name">Client name</Label>
				<Input
					id="convert-client-name"
					name="clientName"
					bind:value={$formData.clientName}
					placeholder="Defaults to lead / company name"
				/>
				{#if $errors.clientName}<p class="text-destructive text-xs">{$errors.clientName}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="convert-client-status">Client status</Label>
				<Select.Root type="single" bind:value={$formData.clientStatus} name="clientStatus">
					<Select.Trigger id="convert-client-status" class="w-full">{statusLabel}</Select.Trigger>
					<Select.Content>
						{#each statusOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Drawer.Close>
					<Button type="button" variant="outline" disabled={busy}>Cancel</Button>
				</Drawer.Close>
				<Button type="submit" disabled={busy} data-testid="convert-confirm">
					{busy ? 'Converting…' : 'Convert to client'}
				</Button>
			</div>
		</form>
	</Drawer.Content>
</Drawer.Root>
