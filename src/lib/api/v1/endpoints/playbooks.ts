import type { ApiRequestFn } from '../request.js';
import type {
	ApiPlaybook,
	ApiPlaybookCreateBody,
	ApiPlaybookListParams,
	ApiPlaybookUpdateBody
} from '../types.js';
import type { PlaybooksEndpoints } from './types.js';

export function createPlaybooksEndpoints(request: ApiRequestFn): PlaybooksEndpoints {
	return {
		list: async (params: ApiPlaybookListParams = {}, signal) => {
			return request<ApiPlaybook[]>('/api/v1/playbooks', {
				orgScoped: true,
				query: {
					limit: params.limit,
					is_active:
						params.is_active === undefined ? undefined : params.is_active ? 'true' : 'false'
				},
				signal
			});
		},
		create: async (body: ApiPlaybookCreateBody, signal) => {
			const { data } = await request<ApiPlaybook>('/api/v1/playbooks', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiPlaybook>(`/api/v1/playbooks/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiPlaybookUpdateBody, version, signal) => {
			const { data } = await request<ApiPlaybook>(`/api/v1/playbooks/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/playbooks/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
