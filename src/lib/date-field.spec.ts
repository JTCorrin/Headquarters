import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@internationalized/date';
import { formatYmd, parseYmd } from './date-field.js';

describe('parseYmd / formatYmd', () => {
	it('parses YYYY-MM-DD and formats back', () => {
		const parsed = parseYmd('2026-08-03');
		expect(parsed).toEqual(new CalendarDate(2026, 8, 3));
		expect(formatYmd(parsed)).toBe('2026-08-03');
	});

	it('returns undefined for empty or invalid strings', () => {
		expect(parseYmd('')).toBeUndefined();
		expect(parseYmd(undefined)).toBeUndefined();
		expect(parseYmd('03/08/2026')).toBeUndefined();
		expect(parseYmd('not-a-date')).toBeUndefined();
	});

	it('formats missing calendar values as empty string', () => {
		expect(formatYmd(undefined)).toBe('');
		expect(formatYmd(null)).toBe('');
	});
});
