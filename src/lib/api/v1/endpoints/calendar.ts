import type { ApiRequestFn } from '../request.js';
import type {
	ApiCalendarCaldavPutBody,
	ApiCalendarConnection,
	ApiCalendarOAuthStart,
	ApiCalendarProvider,
	ApiCalendarTestResult
} from '../types.js';
import type { CalendarEndpoints } from './types.js';

function disconnectedConnection(provider: ApiCalendarProvider = 'google'): ApiCalendarConnection {
	return {
		provider,
		status: 'disconnected',
		credentials_configured: false,
		config: {},
		account_email: null,
		calendar_id: provider === 'caldav' ? 'default' : 'primary',
		last_error_code: null,
		last_sync_at: null
	};
}

function calendarPath(provider?: ApiCalendarProvider): string {
	if (!provider) return '/api/v1/me/calendar';
	return `/api/v1/me/calendar?provider=${encodeURIComponent(provider)}`;
}

export function createCalendarEndpoints(request: ApiRequestFn): CalendarEndpoints {
	return {
		get: async (signal, options) => {
			const provider = options?.provider;
			const { data } = await request<ApiCalendarConnection | null>(calendarPath(provider), {
				orgScoped: true,
				signal
			});
			return data ?? disconnectedConnection(provider ?? 'google');
		},
		put: async (body: ApiCalendarCaldavPutBody, signal) => {
			const { data } = await request<ApiCalendarConnection>('/api/v1/me/calendar', {
				method: 'PUT',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		test: async (body, signal) => {
			const { data } = await request<ApiCalendarTestResult>('/api/v1/me/calendar/test', {
				method: 'POST',
				body: body?.password ? { password: body.password } : undefined,
				orgScoped: true,
				signal
			});
			return data;
		},
		startOAuth: async (signal) => {
			const { data } = await request<ApiCalendarOAuthStart>(
				'/api/v1/me/calendar/oauth/start',
				{
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		disconnect: async (options) => {
			const provider = options?.provider ?? 'google';
			await request<null>(calendarPath(provider), {
				method: 'DELETE',
				orgScoped: true,
				signal: options?.signal
			});
		}
	};
}
