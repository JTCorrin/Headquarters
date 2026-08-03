import { parseDate, type DateValue } from '@internationalized/date';

/** Parse a CRM form date string (`YYYY-MM-DD`) into a calendar value. */
export function parseYmd(value: string | undefined | null): DateValue | undefined {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	try {
		return parseDate(value);
	} catch {
		return undefined;
	}
}

/** Format a calendar value back to a CRM form date string (`YYYY-MM-DD` or empty). */
export function formatYmd(value: DateValue | undefined | null): string {
	if (!value) return '';
	return value.toString();
}
