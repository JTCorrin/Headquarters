<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { Combobox as ComboboxPrimitive } from 'bits-ui';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';
	import type {
		DocumentContactOption,
		DocumentRecipientFormRow
	} from '$lib/schemas/document-recipients.js';

	export interface DocumentRecipientsFieldProps {
		id?: string;
		label?: string;
		recipients: DocumentRecipientFormRow[];
		contactOptions: DocumentContactOption[];
		clientId?: string;
		disabled?: boolean;
		class?: string;
		onRecipientsChange: (next: DocumentRecipientFormRow[]) => void;
	}

	let {
		id = 'document-recipients',
		label = 'Recipients',
		recipients,
		contactOptions,
		clientId = '',
		disabled = false,
		class: className,
		onRecipientsChange
	}: DocumentRecipientsFieldProps = $props();

	let open = $state(false);
	let search = $state('');
	let inputValue = $state('');

	const contactsForClient = $derived(
		contactOptions.filter((c) => !c.clientId || !clientId || c.clientId === clientId)
	);
	const selectedIds = $derived(new Set(recipients.map((r) => r.contactId)));
	const available = $derived(
		contactsForClient.filter(
			(c) =>
				!selectedIds.has(c.id) &&
				c.label.toLowerCase().includes(search.trim().toLowerCase())
		)
	);

	$effect(() => {
		if (!open) inputValue = '';
	});

	function labelFor(contactId: string): string {
		return (
			contactOptions.find((c) => c.id === contactId)?.label ??
			contactsForClient.find((c) => c.id === contactId)?.label ??
			'Selected contact'
		);
	}

	function addContact(contactId: string) {
		if (!contactId || selectedIds.has(contactId) || recipients.length >= 25) return;
		const next: DocumentRecipientFormRow[] = [
			...recipients,
			{ contactId, isBilling: recipients.length === 0 }
		];
		onRecipientsChange(next);
		open = false;
		search = '';
	}

	function removeContact(contactId: string) {
		const next = recipients.filter((r) => r.contactId !== contactId);
		if (next.length > 0 && !next.some((r) => r.isBilling)) {
			next[0] = { ...next[0], isBilling: true };
		}
		onRecipientsChange(next);
	}

	function setBilling(contactId: string) {
		onRecipientsChange(
			recipients.map((r) => ({
				...r,
				isBilling: r.contactId === contactId
			}))
		);
	}
</script>

<div class={cn('space-y-2', className)} data-testid="document-recipients-field">
	<Label for={id}>{label}</Label>

	{#if recipients.length > 0}
		<ul class="flex flex-wrap gap-2" data-testid="document-recipients-chips">
			{#each recipients as row (row.contactId)}
				<li>
					<span
						class={cn(
							'border-border bg-muted/40 inline-flex items-center gap-1 rounded-3xl border px-2 py-1 text-xs',
							row.isBilling && 'border-primary/40 bg-primary/5'
						)}
					>
						<span class="max-w-[14rem] truncate font-medium">{labelFor(row.contactId)}</span>
						{#if row.isBilling}
							<Badge variant="secondary" class="h-4 px-1.5 text-[10px]">Billing</Badge>
						{:else if !disabled}
							<button
								type="button"
								class="text-muted-foreground hover:text-foreground text-[10px] underline-offset-2 hover:underline"
								onclick={() => setBilling(row.contactId)}
								data-testid="document-recipient-set-billing"
							>
								Set billing
							</button>
						{/if}
						{#if !disabled}
							<button
								type="button"
								class="text-muted-foreground hover:text-foreground ml-0.5 inline-flex size-4 items-center justify-center"
								aria-label={`Remove ${labelFor(row.contactId)}`}
								onclick={() => removeContact(row.contactId)}
								data-testid="document-recipient-remove"
							>
								<XIcon class="size-3" />
							</button>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted-foreground text-xs">No recipients — optional.</p>
	{/if}

	{#if !disabled && contactsForClient.length > 0 && recipients.length < 25}
		<ComboboxPrimitive.Root
			type="single"
			bind:open
			inputValue={inputValue}
			onValueChange={addContact}
		>
			<div class="relative">
				<ComboboxPrimitive.Input
					{id}
					class={cn(
						'border-input bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 flex h-9 w-full rounded-3xl border border-transparent px-3 py-2 pr-9 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
						'text-muted-foreground'
					)}
					placeholder="Add contact…"
					oninput={(e) => {
						const next = (e.currentTarget as HTMLInputElement).value;
						search = next;
						inputValue = next;
						if (!open) open = true;
					}}
					onfocus={() => {
						open = true;
						search = '';
						inputValue = '';
					}}
					data-testid="document-recipients-add"
				/>
				<ComboboxPrimitive.Trigger
					class="text-muted-foreground absolute top-0 right-0 flex h-9 w-9 items-center justify-center"
					aria-label="Toggle contact list"
				>
					<ChevronDownIcon class="size-4" />
				</ComboboxPrimitive.Trigger>
			</div>
			<ComboboxPrimitive.Portal>
				<ComboboxPrimitive.Content
					class="bg-popover text-popover-foreground z-50 max-h-72 min-w-[var(--bits-combobox-anchor-width)] overflow-hidden rounded-3xl shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
					sideOffset={4}
				>
					<div class="max-h-72 overflow-y-auto p-1">
						{#if available.length === 0}
							<p class="text-muted-foreground px-3 py-2 text-sm">No contacts to add</p>
						{:else}
							{#each available as option (option.id)}
								<ComboboxPrimitive.Item
									value={option.id}
									label={option.label}
									class="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex cursor-pointer items-center rounded-2xl px-3 py-2 text-sm outline-none"
								>
									{option.label}
								</ComboboxPrimitive.Item>
							{/each}
						{/if}
					</div>
				</ComboboxPrimitive.Content>
			</ComboboxPrimitive.Portal>
		</ComboboxPrimitive.Root>
	{:else if !disabled && recipients.length >= 25}
		<p class="text-muted-foreground text-xs">Max 25 recipients</p>
	{/if}
</div>
