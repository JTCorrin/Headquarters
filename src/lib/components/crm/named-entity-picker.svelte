<script lang="ts">
	import { Combobox as ComboboxPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn } from '$lib/utils.js';

	export interface NamedEntityOption {
		id: string;
		name: string;
	}

	export interface NamedEntityPickerProps {
		id?: string;
		value?: string;
		options: NamedEntityOption[];
		placeholder?: string;
		emptyMessage?: string;
		disabled?: boolean;
		loading?: boolean;
		class?: string;
		'aria-invalid'?: boolean | 'true' | 'false';
		'data-testid'?: string;
		onValueChange?: (id: string) => void;
	}

	let {
		id = 'named-entity-picker',
		value = '',
		options,
		placeholder = 'Select…',
		emptyMessage = 'No matches.',
		disabled = false,
		loading = false,
		class: className,
		'aria-invalid': ariaInvalid = false,
		'data-testid': dataTestId = 'named-entity-picker-input',
		onValueChange
	}: NamedEntityPickerProps = $props();

	let open = $state(false);
	let search = $state('');
	let inputValue = $state('');

	const selected = $derived(options.find((o) => o.id === value) ?? null);
	const filtered = $derived(
		options.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
	);

	$effect(() => {
		if (!open) inputValue = selected?.name ?? '';
	});

	function handleChange(next: string) {
		if (!next) return;
		onValueChange?.(next);
		open = false;
		search = '';
	}
</script>

<ComboboxPrimitive.Root
	type="single"
	bind:open
	{inputValue}
	value={value || undefined}
	onValueChange={handleChange}
	disabled={disabled || loading}
>
	<div class={cn('relative', className)}>
		<ComboboxPrimitive.Input
			{id}
			class={cn(
				'flex h-9 w-full rounded-3xl border border-input border-transparent bg-input/50 px-3 py-2 pr-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
				!selected && 'text-muted-foreground'
			)}
			placeholder={loading ? 'Loading…' : placeholder}
			aria-invalid={ariaInvalid}
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
			data-testid={dataTestId}
		/>
		<ComboboxPrimitive.Trigger
			class="absolute top-0 right-0 flex h-9 w-9 items-center justify-center text-muted-foreground"
			aria-label="Toggle list"
		>
			<ChevronDownIcon class="size-4" />
		</ComboboxPrimitive.Trigger>
	</div>

	<ComboboxPrimitive.Portal>
		<ComboboxPrimitive.Content
			class="z-50 max-h-72 min-w-[var(--bits-combobox-anchor-width)] overflow-hidden rounded-3xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
			sideOffset={4}
		>
			<ComboboxPrimitive.Viewport class="p-1">
				{#if filtered.length === 0}
					<p class="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</p>
				{:else}
					{#each filtered as option (option.id)}
						<ComboboxPrimitive.Item
							value={option.id}
							label={option.name}
							class="relative flex cursor-default items-center gap-2 rounded-2xl px-3 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
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
			</ComboboxPrimitive.Viewport>
		</ComboboxPrimitive.Content>
	</ComboboxPrimitive.Portal>
</ComboboxPrimitive.Root>
