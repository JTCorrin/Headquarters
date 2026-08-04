import {
	CalendarDate,
	endOfMonth,
	endOfWeek,
	getLocalTimeZone,
	startOfMonth,
	startOfWeek,
	today
} from '@internationalized/date';
import { emptyMeetingFormData } from '$lib/api/v1/mappers.js';
import type { MeetingFormData } from '$lib/schemas/meeting.js';

const DEFAULT_SLOT_HOUR = 9;
const DEFAULT_DURATION_MINUTES = 30;

export function calendarMonthLabel(month: CalendarDate): string {
	const formatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
	const date = month.toDate(getLocalTimeZone());
	return formatter.format(date);
}

/** Inclusive visible grid for a month view (Sun–Sat weeks covering the month). */
export function visibleMonthGrid(month: CalendarDate): {
	startsAfter: string;
	startsBefore: string;
	days: CalendarDate[];
} {
	const monthStart = startOfMonth(month);
	const monthEnd = endOfMonth(month);
	const gridStart = startOfWeek(monthStart, 'en-US');
	const gridEnd = endOfWeek(monthEnd, 'en-US');

	const days: CalendarDate[] = [];
	let cursor = gridStart;
	while (cursor.compare(gridEnd) <= 0) {
		days.push(cursor);
		cursor = cursor.add({ days: 1 });
	}

	return {
		startsAfter: calendarDateStartIso(gridStart),
		startsBefore: calendarDateEndIso(gridEnd),
		days
	};
}

export function calendarDateStartIso(day: CalendarDate): string {
	const date = day.toDate(getLocalTimeZone());
	date.setHours(0, 0, 0, 0);
	return date.toISOString();
}

export function calendarDateEndIso(day: CalendarDate): string {
	const date = day.toDate(getLocalTimeZone());
	date.setHours(23, 59, 59, 999);
	return date.toISOString();
}

/** Local `YYYY-MM-DD` key for bucketing meetings onto calendar cells. */
export function localDayKeyFromIso(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function calendarDateKey(day: CalendarDate): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

export function currentCalendarMonth(): CalendarDate {
	return today(getLocalTimeZone());
}

/** Prefill create-drawer fields for an empty calendar day (default 09:00, 30 minutes). */
export function meetingFormPrefillForDay(
	day: CalendarDate,
	options?: { hour?: number; durationMinutes?: number }
): MeetingFormData {
	const hour = options?.hour ?? DEFAULT_SLOT_HOUR;
	const duration = options?.durationMinutes ?? DEFAULT_DURATION_MINUTES;
	const start = day.toDate(getLocalTimeZone());
	start.setHours(hour, 0, 0, 0);
	const end = new Date(start.getTime() + duration * 60_000);
	const pad = (n: number) => String(n).padStart(2, '0');
	const toLocal = (d: Date) =>
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

	return {
		...emptyMeetingFormData(),
		startsAt: toLocal(start),
		endsAt: toLocal(end)
	};
}
