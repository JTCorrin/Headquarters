<script lang="ts">
	import type { CalendarDate } from '@internationalized/date';
	import { isSameMonth } from '@internationalized/date';
	import type { MeetingListItem } from '$lib/schemas/meeting.js';
	import { meetingCalendarLinkLabel } from '$lib/schemas/calendar-connection.js';
	import {
		calendarDateKey,
		localDayKeyFromIso
	} from '$lib/crm/meeting-calendar-range.js';
	import { cn } from '$lib/utils.js';

	export interface MeetingsCalendarGridProps {
		month: CalendarDate;
		days: CalendarDate[];
		meetings: MeetingListItem[];
		onSelectDay?: (day: CalendarDate) => void;
		onSelectMeeting?: (meetingId: string) => void;
		class?: string;
	}

	let {
		month,
		days,
		meetings,
		onSelectDay,
		onSelectMeeting,
		class: className
	}: MeetingsCalendarGridProps = $props();

	const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	const meetingsByDay = $derived.by(() => {
		const map = new Map<string, MeetingListItem[]>();
		for (const meeting of meetings) {
			const key = localDayKeyFromIso(meeting.startsAt);
			if (!key) continue;
			const list = map.get(key) ?? [];
			list.push(meeting);
			map.set(key, list);
		}
		for (const list of map.values()) {
			list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
		}
		return map;
	});

	function timeLabel(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
	}
</script>

<div
	class={cn('overflow-hidden rounded-2xl border border-border', className)}
	data-testid="meetings-calendar-grid"
>
	<div class="bg-muted/40 grid grid-cols-7 border-b border-border">
		{#each weekdayLabels as label (label)}
			<div class="text-muted-foreground px-2 py-2 text-center text-xs font-medium tracking-wide">
				{label}
			</div>
		{/each}
	</div>

	<div class="grid grid-cols-7">
		{#each days as day (calendarDateKey(day))}
			{@const key = calendarDateKey(day)}
			{@const dayMeetings = meetingsByDay.get(key) ?? []}
			{@const inMonth = isSameMonth(day, month)}
			<div
				class={cn(
					'min-h-28 border-border/70 flex flex-col gap-1 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0',
					!inMonth && 'bg-muted/20'
				)}
			>
				<button
					type="button"
					class={cn(
						'hover:bg-accent/60 flex size-7 items-center justify-center rounded-full text-xs font-medium',
						!inMonth && 'text-muted-foreground'
					)}
					data-testid="calendar-day-{key}"
					aria-label="Schedule on {key}"
					onclick={() => onSelectDay?.(day)}
				>
					{day.day}
				</button>
				<div class="flex min-h-0 flex-1 flex-col gap-0.5">
					{#each dayMeetings.slice(0, 3) as meeting (meeting.id)}
						{@const linkedLabel = meetingCalendarLinkLabel(meeting.calendarProvider)}
						<button
							type="button"
							class="bg-primary/10 text-primary hover:bg-primary/15 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight"
							data-testid="calendar-meeting-{meeting.id}"
							onclick={() => onSelectMeeting?.(meeting.id)}
						>
							<span class="font-medium">{timeLabel(meeting.startsAt)}</span>
							<span class="text-primary/80"> {meeting.title}</span>
							{#if linkedLabel}
								<span
									class="text-primary/70 ml-0.5"
									data-testid="calendar-meeting-linked-{meeting.id}"
									title="Linked to {linkedLabel} Calendar"
								>
									· {linkedLabel}
								</span>
							{/if}
						</button>
					{/each}
					{#if dayMeetings.length > 3}
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground px-1 text-left text-[11px]"
							onclick={() => onSelectDay?.(day)}
						>
							+{dayMeetings.length - 3} more
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
