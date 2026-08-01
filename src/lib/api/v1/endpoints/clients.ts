import type { ApiRequestFn } from '../request.js';
import type {
	ApiClient,
	ApiClientCreateBody,
	ApiClientListParams,
	ApiClientUpdateBody
} from '../types.js';
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
		},
		create: async (body: ApiClientCreateBody, signal) => {
			const { data } = await request<ApiClient>('/api/v1/clients', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiClient>(`/api/v1/clients/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiClientUpdateBody, version, signal) => {
			const { data } = await request<ApiClient>(`/api/v1/clients/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/clients/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
