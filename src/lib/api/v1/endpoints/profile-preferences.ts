import type { ApiRequestFn } from '../request.js';
import type { ApiProfilePreferences, ApiProfilePreferencesPatch } from '../types.js';
import type { ProfilePreferencesEndpoints } from './types.js';

export function createProfilePreferencesEndpoints(
	request: ApiRequestFn
): ProfilePreferencesEndpoints {
	return {
		get: async (signal) => {
			const { data } = await request<ApiProfilePreferences>('/api/v1/profile/preferences', {
				orgScoped: false,
				signal
			});
			return data;
		},
		update: async (body: ApiProfilePreferencesPatch, signal) => {
			const { data } = await request<ApiProfilePreferences>('/api/v1/profile/preferences', {
				method: 'PATCH',
				body,
				orgScoped: false,
				signal
			});
			return data;
		}
	};
}
