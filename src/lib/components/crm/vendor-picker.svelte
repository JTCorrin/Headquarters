<script lang="ts">
	import { Combobox as ComboboxPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn } from '$lib/utils.js';

	export interface VendorPickerOption {
		id: string;
		name: string;
		defaultCurrency?: string | null;
	}

	export interface VendorPickerProps {
		id?: string;
		value?: string;
		options: VendorPickerOption[];
		placeholder?: string;
		disabled?: boolean;
		class?: string;
		'aria-invalid'?: boolean | 'true' | 'false';
		onValueChange?: (id: string) => void;
		onCreateNew?: () => void;
	}

	const CREATE_NEW = '__create_new_vendor__';

	let {
		id = 'vendor-picker',
		value = '',
		options,
		placeholder = 'Select vendor',
		disabled = false,
		class: className,
		'aria-invalid': ariaInvalid = false,
		onValueChange,
		onCreateNew
	}: VendorPickerProps = $props();

	let open = $state(false);
	let search = $state('');

	const selected = $derived(options.find((o) => o.id === value) ?? null);
	const filtered = $derived(
		options.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
	);

	function handleChange(next: string) {
		if (!next) return;
		if (next === CREATE_NEW) {
			open = false;
			search = '';
			onCreateNew?.();
			return;
		}
		onValueChange?.(next);
		open = false;
		search = '';
	}
</script>

<ComboboxPrimitive.Root
	type="single"
	bind:open
	value={value || undefined}
	onValueChange={handleChange}
	{disabled}
>
	<div class={cn('relative', className)}>
		<ComboboxPrimitive.Input
			{id}
			class={cn(
				'border-input bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 flex h-9 w-full rounded-3xl border border-transparent px-3 py-2 pr-9 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
				!selected && 'text-muted-foreground'
			)}
			placeholder={placeholder}
			aria-invalid={ariaInvalid}
			value={open ? search : (selected?.name ?? '')}
			oninput={(e) => {
				search = (e.currentTarget as HTMLInputElement).value;
				if (!open) open = true;
			}}
			onfocus={() => {
				open = true;
				search = '';
			}}
			data-testid="vendor-picker-input"
		/>
		<ComboboxPrimitive.Trigger
			class="text-muted-foreground absolute top-0 right-0 flex h-9 w-9 items-center justify-center"
			aria-label="Toggle vendor list"
		>
			<ChevronDownIcon class="size-4" />
		</ComboboxPrimitive.Trigger>
	</div>

	<ComboboxPrimitive.Portal>
		<ComboboxPrimitive.Content
			class="bg-popover text-popover-foreground z-50 max-h-72 min-w-[var(--bits-combobox-anchor-width)] overflow-hidden rounded-3xl shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
			sideOffset={4}
		>
			<ComboboxPrimitive.Viewport class="p-1">
				{#if filtered.length === 0}
					<p class="text-muted-foreground px-3 py-2 text-sm">
						{options.length === 0 ? 'No vendors yet.' : 'No vendors match.'}
					</p>
				{:else}
					{#each filtered as option (option.id)}
						<ComboboxPrimitive.Item
							value={option.id}
							label={option.name}
							class="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-2xl px-3 py-2 text-sm outline-none select-none"
						>
							{#snippet children({ selected: isSelected })}
								<span class="truncate">{option.name}</span>
								{#if isSelected}
									<CheckIcon class="ml-auto size-4 shrink-0" />
								{/if}
							{/snippet}
						</ComboboxPrimitive.Item>
					{/each}
				{/if}
				{#if onCreateNew}
					<div class="bg-border my-1 h-px" role="separator"></div>
					<ComboboxPrimitive.Item
						value={CREATE_NEW}
						label="Create new vendor"
						class="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex cursor-default items-center rounded-2xl px-3 py-2 text-sm font-medium outline-none select-none"
					>
						Create new vendor
					</ComboboxPrimitive.Item>
				{/if}
			</ComboboxPrimitive.Viewport>
		</ComboboxPrimitive.Content>
	</ComboboxPrimitive.Portal>
</ComboboxPrimitive.Root>
