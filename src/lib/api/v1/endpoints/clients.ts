import type { ApiRequestFn } from '../request.js';
import type { ApiClient, ApiClientListParams } from '../types.js';
import type { ClientsEndpoints } from './types.js';

export function createClientsEndpoints(request: ApiRequestFn): ClientsEndpoints {
	return {
		list: async (params: ApiClientListParams = {}, signal) => {
			return request<ApiClient[]>('/api/v1/clients', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor
				},
				signal
			});
		}
	};
}
