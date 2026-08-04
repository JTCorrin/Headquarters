import { describe, expect, it } from 'vitest';
import {
	calendarConnectionLabel,
	mapCalendarConnectionStatus,
	meetingCalendarLinkLabel
} from './calendar-connection.js';

describe('calendar-connection helpers', () => {
	it('maps active wire status to connected', () => {
		expect(mapCalendarConnectionStatus('active')).toBe('connected');
		expect(mapCalendarConnectionStatus('disconnected')).toBe('disconnected');
		expect(mapCalendarConnectionStatus('error')).toBe('error');
	});

	it('labels linked meetings for calendar chips', () => {
		expect(meetingCalendarLinkLabel('google')).toBe('Google');
		expect(meetingCalendarLinkLabel(null)).toBeNull();
	});

	it('renders human connection labels', () => {
		expect(
			calendarConnectionLabel({
				provider: 'google',
				credentials_configured: true,
				status: 'connected',
				account_label: 'joe@acme.test',
				last_error_code: null,
				last_checked_at: null
			})
		).toBe('joe@acme.test');
	});
});
