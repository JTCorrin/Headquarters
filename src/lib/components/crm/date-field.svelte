<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		DateFormatter,
		endOfMonth,
		getLocalTimeZone,
		today,
		type DateValue
	} from '@internationalized/date';
	import { formatYmd, parseYmd, type DateFieldPreset } from '$lib/date-field.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Calendar } from '$lib/components/ui/calendar/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
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
		/** Popover preset chips. Default: Today. Pass due-date presets where natural. */
		presets?: DateFieldPreset[];
		/** Minimum selectable / typed date as `YYYY-MM-DD`. */
		min?: string;
		/** Maximum selectable / typed date as `YYYY-MM-DD`. */
		max?: string;
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
		presets = ['today'],
		min = '',
		max = '',
		placeholder = 'YYYY-MM-DD',
		class: className,
		'aria-invalid': ariaInvalid = false,
		'aria-label': ariaLabel,
		'data-testid': dataTestId = 'date-field'
	}: DateFieldProps = $props();

	const displayFormatter = new DateFormatter('en-GB', { dateStyle: 'medium' });

	let open = $state(false);
	let text = $state(value ?? '');
	let calendarValue = $state<DateValue | undefined>(undefined);
	let calendarPlaceholder = $state<DateValue | undefined>(undefined);

	const minValue = $derived(parseYmd(min));
	const maxValue = $derived(parseYmd(max));

	$effect(() => {
		const nextValue = value ?? '';
		text = nextValue;
		const parsed = parseYmd(nextValue);
		calendarValue = parsed;
		if (parsed) calendarPlaceholder = parsed;
	});

	const interactive = $derived(!disabled && !readonly);
	const showClear = $derived(clearable && interactive && Boolean(value));
	const displayTitle = $derived.by(() => {
		const parsed = parseYmd(value);
		if (!parsed) return undefined;
		return displayFormatter.format(parsed.toDate(getLocalTimeZone()));
	});

	function inBounds(next: DateValue | undefined): boolean {
		if (!next) return true;
		if (minValue && next.compare(minValue) < 0) return false;
		if (maxValue && next.compare(maxValue) > 0) return false;
		return true;
	}

	function commitText(next: string) {
		text = next;
		if (next === '') {
			value = '';
			return;
		}
		const parsed = parseYmd(next);
		if (parsed && inBounds(parsed)) {
			value = next;
		}
	}

	function onBlur() {
		if (text === '') {
			value = '';
			return;
		}
		const parsed = parseYmd(text);
		if (parsed && inBounds(parsed)) {
			value = text;
			return;
		}
		text = value ?? '';
	}

	function onValueChange(next: DateValue | undefined) {
		if (next && !inBounds(next)) return;
		calendarValue = next;
		value = formatYmd(next);
		text = value;
		open = false;
	}

	function onClear(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		value = '';
		text = '';
		calendarValue = undefined;
	}

	function applyPreset(preset: DateFieldPreset) {
		const base = today(getLocalTimeZone());
		const next =
			preset === 'today'
				? base
				: preset === 'plus7'
					? base.add({ days: 7 })
					: endOfMonth(base);
		onValueChange(next);
	}

	function presetLabel(preset: DateFieldPreset): string {
		if (preset === 'today') return 'Today';
		if (preset === 'plus7') return '+7 days';
		return 'End of month';
	}

	function onInputKeydown(event: KeyboardEvent) {
		if (!interactive) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			open = true;
		}
	}
</script>

<div class={cn('relative', className)} data-slot="date-field">
	<Input
		{id}
		{name}
		{disabled}
		readonly={readonly || !interactive}
		value={text}
		{placeholder}
		aria-invalid={ariaInvalid}
		aria-label={ariaLabel}
		title={displayTitle}
		data-testid={dataTestId}
		autocomplete="off"
		spellcheck={false}
		class={cn('pe-16', showClear && 'pe-20')}
		oninput={(event) => commitText(event.currentTarget.value)}
		onblur={onBlur}
		onkeydown={onInputKeydown}
	/>

	<div class="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
		{#if showClear}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center rounded-full"
				data-testid="{dataTestId}-clear"
				aria-label="Clear date"
				onclick={onClear}
			>
				<XIcon class="size-3.5" />
			</button>
		{/if}

		{#if interactive}
			<Popover.Root bind:open>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							type="button"
							variant="ghost"
							size="icon-xs"
							class="size-6"
							aria-label="Open calendar"
							data-testid="{dataTestId}-calendar"
						>
							<CalendarIcon class="size-3.5" />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content class="w-auto overflow-hidden p-0" align="end">
					<Calendar
						type="single"
						value={calendarValue}
						bind:placeholder={calendarPlaceholder}
						captionLayout="dropdown"
						initialFocus
						minValue={minValue}
						maxValue={maxValue}
						{onValueChange}
					/>
					{#if presets.length > 0 || clearable}
						<div class="flex flex-wrap items-center gap-1 border-t px-3 py-2">
							{#each presets as preset (preset)}
								<Button
									type="button"
									variant="ghost"
									size="xs"
									data-testid="{dataTestId}-preset-{preset}"
									onclick={() => applyPreset(preset)}
								>
									{presetLabel(preset)}
								</Button>
							{/each}
							{#if clearable}
								<Button
									type="button"
									variant="ghost"
									size="xs"
									class="ms-auto"
									data-testid="{dataTestId}-preset-clear"
									onclick={() => onValueChange(undefined)}
								>
									Clear
								</Button>
							{/if}
						</div>
					{/if}
				</Popover.Content>
			</Popover.Root>
		{:else}
			<span
				class="text-muted-foreground inline-flex size-6 items-center justify-center opacity-50"
				aria-hidden="true"
			>
				<CalendarIcon class="size-3.5" />
			</span>
		{/if}
	</div>
</div>
