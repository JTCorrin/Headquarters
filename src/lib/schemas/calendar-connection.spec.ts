import { describe, expect, it } from 'vitest';
import {
	calendarConnectionLabel,
	calendarProviderDisplayName,
	caldavFormFromResource,
	emptyCaldavFormData,
	mapCalendarConnectionStatus,
	meetingCalendarLinkLabel
} from './calendar-connection.js';

describe('calendar-connection helpers', () => {
	it('maps active wire status to connected', () => {
		expect(mapCalendarConnectionStatus('active')).toBe('connected');
		expect(mapCalendarConnectionStatus('disconnected')).toBe('disconnected');
		expect(mapCalendarConnectionStatus('disabled')).toBe('disconnected');
		expect(mapCalendarConnectionStatus('error')).toBe('error');
	});

	it('labels linked meetings for calendar chips', () => {
		expect(meetingCalendarLinkLabel('google')).toBe('Google');
		expect(meetingCalendarLinkLabel('caldav')).toBe('CalDAV');
		expect(meetingCalendarLinkLabel(null)).toBeNull();
	});

	it('renders human connection labels', () => {
		expect(
			calendarConnectionLabel({
				provider: 'google',
				credentials_configured: true,
				status: 'connected',
				account_label: 'joe@acme.test',
				caldav_url: null,
				calendar_id: 'primary',
				last_error_code: null,
				last_checked_at: null
			})
		).toBe('joe@acme.test');
		expect(
			calendarConnectionLabel({
				provider: 'caldav',
				credentials_configured: true,
				status: 'connected',
				account_label: null,
				caldav_url: 'https://caldav.example.test/cal/',
				calendar_id: 'default',
				last_error_code: null,
				last_checked_at: null
			})
		).toBe('CalDAV connected');
	});

	it('names CalDAV provider for display', () => {
		expect(calendarProviderDisplayName('caldav')).toBe('CalDAV');
		expect(calendarProviderDisplayName('google')).toBe('Google');
	});

	it('builds empty and resource-backed CalDAV form data without password echo', () => {
		expect(emptyCaldavFormData().password).toBe('');
		const form = caldavFormFromResource({
			provider: 'caldav',
			credentials_configured: true,
			status: 'connected',
			account_label: 'user@mail.test',
			caldav_url: 'https://caldav.example.test/SOGo/dav/user/Calendar/',
			calendar_id: 'personal',
			last_error_code: null,
			last_checked_at: null
		});
		expect(form.caldavUrl).toContain('caldav.example.test');
		expect(form.username).toBe('user@mail.test');
		expect(form.calendarId).toBe('personal');
		expect(form.password).toBe('');
	});
});
