import type { ApiRequestFn } from '../request.js';
import type { ApiCalendarConnection, ApiCalendarOAuthStart } from '../types.js';
import type { CalendarEndpoints } from './types.js';

function disconnectedConnection(): ApiCalendarConnection {
	return {
		provider: null,
		status: 'disconnected',
		credentials_configured: false,
		config: null,
		last_error_code: null,
		last_checked_at: null
	};
}

export function createCalendarEndpoints(request: ApiRequestFn): CalendarEndpoints {
	return {
		get: async (signal) => {
			const { data } = await request<ApiCalendarConnection | null>('/api/v1/me/calendar', {
				orgScoped: true,
				signal
			});
			return data ?? disconnectedConnection();
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
		disconnect: async (signal) => {
			await request<null>('/api/v1/me/calendar', {
				method: 'DELETE',
				orgScoped: true,
				signal
			});
		}
	};
}
