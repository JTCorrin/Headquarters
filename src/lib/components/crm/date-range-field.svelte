<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import XIcon from '@lucide/svelte/icons/x';
	import { getLocalTimeZone, today, type DateValue } from '@internationalized/date';
	import { formatYmd, parseYmd } from '$lib/date-field.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { RangeCalendar } from '$lib/components/ui/range-calendar/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn } from '$lib/utils.js';

	type DateRange = {
		start: DateValue | undefined;
		end: DateValue | undefined;
	};

	export interface DateRangeFieldProps {
		startId?: string;
		endId?: string;
		startName?: string;
		endName?: string;
		startValue?: string;
		endValue?: string;
		startLabel?: string;
		endLabel?: string;
		disabled?: boolean;
		readonly?: boolean;
		clearable?: boolean;
		class?: string;
		'data-testid'?: string;
	}

	let {
		startId,
		endId,
		startName,
		endName,
		startValue = $bindable(''),
		endValue = $bindable(''),
		startLabel = 'Start on',
		endLabel = 'End on (optional)',
		disabled = false,
		readonly = false,
		clearable = true,
		class: className,
		'data-testid': dataTestId = 'date-range-field'
	}: DateRangeFieldProps = $props();

	let open = $state(false);
	let startText = $state(startValue ?? '');
	let endText = $state(endValue ?? '');
	let rangeValue = $state<DateRange>({ start: undefined, end: undefined });
	let calendarPlaceholder = $state<DateValue | undefined>(undefined);

	$effect(() => {
		const nextStart = startValue ?? '';
		const nextEnd = endValue ?? '';
		startText = nextStart;
		endText = nextEnd;
		const start = parseYmd(nextStart);
		const end = parseYmd(nextEnd);
		rangeValue = { start, end };
		if (start) calendarPlaceholder = start;
		else if (end) calendarPlaceholder = end;
	});

	const interactive = $derived(!disabled && !readonly);
	const showStartClear = $derived(clearable && interactive && Boolean(startValue));
	const showEndClear = $derived(clearable && interactive && Boolean(endValue));
	/** Optional end must be on/after start when both are set. */
	const endMinValue = $derived(parseYmd(startValue));

	function commitStart(next: string) {
		startText = next;
		if (next === '' || parseYmd(next)) {
			startValue = next;
			const start = parseYmd(next);
			const end = parseYmd(endValue);
			if (start && end && start.compare(end) > 0) {
				endValue = '';
				endText = '';
			}
		}
	}

	function commitEnd(next: string) {
		endText = next;
		if (next === '') {
			endValue = '';
			return;
		}
		const parsed = parseYmd(next);
		if (!parsed) return;
		if (endMinValue && parsed.compare(endMinValue) < 0) return;
		endValue = next;
	}

	function onStartBlur() {
		if (startText === '' || parseYmd(startText)) {
			commitStart(startText);
			return;
		}
		startText = startValue ?? '';
	}

	function onEndBlur() {
		if (endText === '') {
			endValue = '';
			return;
		}
		const parsed = parseYmd(endText);
		if (parsed && (!endMinValue || parsed.compare(endMinValue) >= 0)) {
			endValue = endText;
			return;
		}
		endText = endValue ?? '';
	}

	function onRangeChange(next: DateRange | undefined) {
		const start = next?.start;
		const end = next?.end;
		rangeValue = { start, end };
		startValue = formatYmd(start);
		endValue = formatYmd(end);
		startText = startValue;
		endText = endValue;
		if (start && end) open = false;
	}

	function clearStart(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		startValue = '';
		startText = '';
	}

	function clearEnd(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		endValue = '';
		endText = '';
	}

	function setStartToday() {
		const next = today(getLocalTimeZone());
		startValue = formatYmd(next);
		startText = startValue;
		const end = parseYmd(endValue);
		if (end && next.compare(end) > 0) {
			endValue = '';
			endText = '';
		}
		rangeValue = { start: next, end: parseYmd(endValue) };
	}

	function onKeydown(event: KeyboardEvent) {
		if (!interactive) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			open = true;
		}
	}
</script>

<div
	class={cn('grid gap-4 sm:grid-cols-2', className)}
	data-slot="date-range-field"
	data-testid={dataTestId}
>
	<div class="space-y-2">
		{#if startLabel}
			<Label for={startId}>{startLabel}</Label>
		{/if}
		<div class="relative">
			<Input
				id={startId}
				name={startName}
				{disabled}
				readonly={readonly || !interactive}
				value={startText}
				placeholder="YYYY-MM-DD"
				data-testid="{dataTestId}-start"
				autocomplete="off"
				spellcheck={false}
				class={cn('pe-16', showStartClear && 'pe-20')}
				oninput={(event) => commitStart(event.currentTarget.value)}
				onblur={onStartBlur}
				onkeydown={onKeydown}
			/>
			<div class="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
				{#if showStartClear}
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center rounded-full"
						data-testid="{dataTestId}-start-clear"
						aria-label="Clear start date"
						onclick={clearStart}
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
									aria-label="Open range calendar"
									data-testid="{dataTestId}-calendar"
								>
									<CalendarIcon class="size-3.5" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-auto overflow-hidden p-0" align="start">
							<RangeCalendar
								value={rangeValue}
								bind:placeholder={calendarPlaceholder}
								captionLayout="dropdown"
								onValueChange={onRangeChange}
							/>
							<div class="flex flex-wrap items-center gap-1 border-t px-3 py-2">
								<Button
									type="button"
									variant="ghost"
									size="xs"
									data-testid="{dataTestId}-preset-today"
									onclick={setStartToday}
								>
									Today
								</Button>
								{#if clearable}
									<Button
										type="button"
										variant="ghost"
										size="xs"
										class="ms-auto"
										data-testid="{dataTestId}-preset-clear"
										onclick={() => onRangeChange({ start: undefined, end: undefined })}
									>
										Clear
									</Button>
								{/if}
							</div>
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
	</div>

	<div class="space-y-2">
		{#if endLabel}
			<Label for={endId}>{endLabel}</Label>
		{/if}
		<div class="relative">
			<Input
				id={endId}
				name={endName}
				{disabled}
				readonly={readonly || !interactive}
				value={endText}
				placeholder="YYYY-MM-DD"
				data-testid="{dataTestId}-end"
				autocomplete="off"
				spellcheck={false}
				class={cn('pe-16', showEndClear && 'pe-20')}
				oninput={(event) => commitEnd(event.currentTarget.value)}
				onblur={onEndBlur}
				onkeydown={onKeydown}
			/>
			<div class="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
				{#if showEndClear}
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center rounded-full"
						data-testid="{dataTestId}-end-clear"
						aria-label="Clear end date"
						onclick={clearEnd}
					>
						<XIcon class="size-3.5" />
					</button>
				{/if}
				{#if interactive}
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center rounded-full"
						aria-label="Open range calendar"
						data-testid="{dataTestId}-calendar-end"
						onclick={() => {
							open = true;
						}}
					>
						<CalendarIcon class="size-3.5" />
					</button>
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
	</div>
</div>
