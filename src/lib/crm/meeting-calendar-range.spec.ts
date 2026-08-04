import { CalendarDate } from '@internationalized/date';
import { describe, expect, it } from 'vitest';
import {
	calendarDateKey,
	calendarMonthLabel,
	localDayKeyFromIso,
	meetingFormPrefillForDay,
	visibleMonthGrid
} from './meeting-calendar-range.js';

describe('meeting-calendar-range', () => {
	it('builds a visible month grid with range bounds covering padded weeks', () => {
		const month = new CalendarDate(2026, 8, 1);
		const grid = visibleMonthGrid(month);

		expect(grid.days.length % 7).toBe(0);
		expect(grid.days.length).toBeGreaterThanOrEqual(28);
		expect(calendarDateKey(grid.days[0]!)).toBe('2026-07-26');
		expect(calendarDateKey(grid.days.at(-1)!)).toBe('2026-09-05');
		expect(new Date(grid.startsAfter).toISOString()).toBe(grid.startsAfter);
		expect(new Date(grid.startsBefore).getTime()).toBeGreaterThan(
			new Date(grid.startsAfter).getTime()
		);
		expect(calendarMonthLabel(month)).toMatch(/2026/);
	});

	it('prefills create form for a day at 09:00 for 30 minutes', () => {
		const day = new CalendarDate(2026, 8, 12);
		const form = meetingFormPrefillForDay(day);
		expect(form.startsAt).toBe('2026-08-12T09:00');
		expect(form.endsAt).toBe('2026-08-12T09:30');
		expect(form.title).toBe('');
		expect(form.status).toBe('scheduled');
	});

	it('maps ISO timestamps to local day keys', () => {
		const key = localDayKeyFromIso('2026-08-10T14:00:00.000Z');
		expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
