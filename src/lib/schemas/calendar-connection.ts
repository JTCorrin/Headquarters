import { z } from 'zod';
import type {
	ApiCalendarConnection,
	ApiCalendarConnectionStatus,
	ApiCalendarProvider
} from '$lib/api/v1/types.js';

export type CalendarProvider = ApiCalendarProvider;

export type CalendarConnectionStatus =
	| 'disconnected'
	| 'pending'
	| 'connected'
	| 'error';

export interface CalendarConnectionResource {
	provider: CalendarProvider | null;
	credentials_configured: boolean;
	status: CalendarConnectionStatus;
	/** Non-secret account email / CalDAV username for display. */
	account_label: string | null;
	/** CalDAV collection URL when provider is caldav (never includes password). */
	caldav_url: string | null;
	calendar_id: string | null;
	last_error_code: string | null;
	last_checked_at: string | null;
}

/** Superforms SPA shape — password is write-only (empty = keep existing). */
export const caldavFormSchema = z.object({
	caldavUrl: z
		.string()
		.trim()
		.min(8, 'CalDAV URL is required')
		.max(2000, 'CalDAV URL must be at most 2000 characters')
		.refine((value) => {
			try {
				const url = new URL(value);
				return url.protocol === 'https:' || url.protocol === 'http:';
			} catch {
				return false;
			}
		}, 'Enter a valid http(s) CalDAV URL'),
	username: z.string().trim().min(1, 'Username is required').max(320),
	password: z.string().max(512),
	calendarId: z.string().trim().max(500)
});

export type CaldavFormData = z.infer<typeof caldavFormSchema>;

export interface CaldavTestFeedback {
	ok: boolean;
	message: string;
}

export function emptyCaldavFormData(): CaldavFormData {
	return {
		caldavUrl: '',
		username: '',
		password: '',
		calendarId: ''
	};
}

export function caldavFormFromResource(resource: CalendarConnectionResource): CaldavFormData {
	return {
		caldavUrl: resource.caldav_url ?? '',
		username: resource.account_label ?? '',
		password: '',
		calendarId: resource.calendar_id === 'default' ? '' : (resource.calendar_id ?? '')
	};
}

export function mapCalendarConnectionStatus(
	status: ApiCalendarConnectionStatus | null | undefined
): CalendarConnectionStatus {
	const key = (status ?? 'disconnected').toLowerCase();
	if (key === 'active' || key === 'connected' || key === 'ok') return 'connected';
	if (key === 'pending') return 'pending';
	if (key === 'error' || key === 'auth_failed') return 'error';
	// Cal-Sync-BE uses `disabled` after XOR / disconnect until row is gone; treat as disconnected.
	if (key === 'disabled' || key === 'disconnected') return 'disconnected';
	return 'disconnected';
}

/** Connect/disconnect — billing blocked by personal settings; readonly can view only. */
export function canMutateCalendarConnection(role: string): boolean {
	return role === 'owner' || role === 'admin' || role === 'member';
}

export function emptyCalendarConnection(): CalendarConnectionResource {
	return {
		provider: null,
		credentials_configured: false,
		status: 'disconnected',
		account_label: null,
		caldav_url: null,
		calendar_id: null,
		last_error_code: null,
		last_checked_at: null
	};
}

export function calendarConnectionLabel(connection: CalendarConnectionResource): string {
	if (connection.status === 'connected' && connection.account_label) {
		return connection.account_label;
	}
	if (connection.status === 'connected') {
		if (connection.provider === 'caldav') return 'CalDAV connected';
		return 'Google Calendar connected';
	}
	if (connection.status === 'pending') return 'Connecting…';
	if (connection.status === 'error') {
		return connection.last_error_code
			? `Connection error (${connection.last_error_code})`
			: 'Connection error';
	}
	return 'Not connected';
}

export function calendarProviderDisplayName(provider: string | null | undefined): string {
	if (!provider) return 'Linked';
	const key = provider.toLowerCase();
	if (key === 'google') return 'Google';
	if (key === 'microsoft') return 'Microsoft';
	if (key === 'caldav') return 'CalDAV';
	return provider;
}

/** Presentational helper for meeting list/calendar chips. */
export function meetingCalendarLinkLabel(provider: string | null | undefined): string | null {
	if (!provider?.trim()) return null;
	return calendarProviderDisplayName(provider);
}

export type { ApiCalendarConnection };
