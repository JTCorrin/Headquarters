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
	/** Non-secret account email / label for display. */
	account_label: string | null;
	last_error_code: string | null;
	last_checked_at: string | null;
}

export function mapCalendarConnectionStatus(
	status: ApiCalendarConnectionStatus | null | undefined
): CalendarConnectionStatus {
	const key = (status ?? 'disconnected').toLowerCase();
	if (key === 'active' || key === 'connected' || key === 'ok') return 'connected';
	if (key === 'pending') return 'pending';
	if (key === 'error' || key === 'auth_failed') return 'error';
	// Cal-Sync-BE uses `disabled` after disconnect until row is gone; treat as disconnected.
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
		last_error_code: null,
		last_checked_at: null
	};
}

export function calendarConnectionLabel(connection: CalendarConnectionResource): string {
	if (connection.status === 'connected' && connection.account_label) {
		return connection.account_label;
	}
	if (connection.status === 'connected') return 'Google Calendar connected';
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
	return provider;
}

/** Presentational helper for meeting list/calendar chips. */
export function meetingCalendarLinkLabel(provider: string | null | undefined): string | null {
	if (!provider?.trim()) return null;
	return calendarProviderDisplayName(provider);
}

export type { ApiCalendarConnection };
