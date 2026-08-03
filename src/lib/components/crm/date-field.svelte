<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import XIcon from '@lucide/svelte/icons/x';
	import type { DateValue } from '@internationalized/date';
	import { formatYmd, parseYmd } from '$lib/date-field.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Calendar } from '$lib/components/ui/calendar/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn } from '$lib/utils.js';

	export interface DateFieldProps {
		id?: string;
		name?: string;
		value?: string;
		disabled?: boolean;
		readonly?: boolean;
		/** When true (default), show a clear control if a value is set. */
		clearable?: boolean;
		placeholder?: string;
		class?: string;
		'aria-invalid'?: boolean | 'true' | 'false';
		'aria-label'?: string;
		'data-testid'?: string;
	}

	let {
		id,
		name,
		value = $bindable(''),
		disabled = false,
		readonly = false,
		clearable = true,
		placeholder = 'Pick a date',
		class: className,
		'aria-invalid': ariaInvalid = false,
		'aria-label': ariaLabel,
		'data-testid': dataTestId = 'date-field'
	}: DateFieldProps = $props();

	let open = $state(false);
	let calendarValue = $state<DateValue | undefined>(undefined);
	let calendarPlaceholder = $state<DateValue | undefined>(undefined);

	$effect(() => {
		const next = parseYmd(value);
		calendarValue = next;
		if (next) calendarPlaceholder = next;
	});

	const interactive = $derived(!disabled && !readonly);
	const showClear = $derived(clearable && interactive && Boolean(value));

	function onValueChange(next: DateValue | undefined) {
		calendarValue = next;
		value = formatYmd(next);
		open = false;
	}

	function onClear(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		value = '';
		calendarValue = undefined;
	}
</script>

{#if name}
	<input type="hidden" {name} value={value ?? ''} />
{/if}

<div class={cn('relative', className)} data-slot="date-field">
	{#if interactive}
		<Popover.Root bind:open>
			<Popover.Trigger {id}>
				{#snippet child({ props })}
					<Button
						{...props}
						type="button"
						variant="outline"
						aria-invalid={ariaInvalid}
						aria-label={ariaLabel}
						data-testid={dataTestId}
						class={cn(
							'h-9 w-full justify-start rounded-3xl border-transparent bg-input/50 px-3 font-normal',
							!value && 'text-muted-foreground',
							showClear && 'pe-9'
						)}
					>
						<CalendarIcon data-icon="inline-start" class="size-4 opacity-70" />
						<span class="truncate">{value || placeholder}</span>
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-auto overflow-hidden p-0" align="start">
				<Calendar
					type="single"
					value={calendarValue}
					bind:placeholder={calendarPlaceholder}
					captionLayout="dropdown"
					{onValueChange}
				/>
			</Popover.Content>
		</Popover.Root>
	{:else}
		<Button
			type="button"
			variant="outline"
			{id}
			disabled
			aria-invalid={ariaInvalid}
			aria-label={ariaLabel}
			data-testid={dataTestId}
			class={cn(
				'h-9 w-full justify-start rounded-3xl border-transparent bg-input/50 px-3 font-normal',
				!value && 'text-muted-foreground'
			)}
		>
			<CalendarIcon data-icon="inline-start" class="size-4 opacity-70" />
			<span class="truncate">{value || placeholder}</span>
		</Button>
	{/if}

	{#if showClear}
		<button
			type="button"
			class="text-muted-foreground hover:text-foreground absolute end-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full"
			data-testid="{dataTestId}-clear"
			aria-label="Clear date"
			onclick={onClear}
		>
			<XIcon class="size-3.5" />
		</button>
	{/if}
</div>
