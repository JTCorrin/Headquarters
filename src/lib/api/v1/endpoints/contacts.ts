import type { ApiRequestFn } from '../request.js';
import type {
	ApiContact,
	ApiContactCreateBody,
	ApiContactListParams,
	ApiContactUpdateBody
} from '../types.js';
import type { ContactsEndpoints } from './types.js';

export function createContactsEndpoints(request: ApiRequestFn): ContactsEndpoints {
	return {
		list: async (params: ApiContactListParams = {}, signal) => {
			return request<ApiContact[]>('/api/v1/contacts', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					lifecycle_status: params.lifecycle_status,
					client_id: params.client_id
				},
				signal
			});
		},
		create: async (body: ApiContactCreateBody, signal) => {
			const { data } = await request<ApiContact>('/api/v1/contacts', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiContact>(`/api/v1/contacts/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiContactUpdateBody, version, signal) => {
			const { data } = await request<ApiContact>(`/api/v1/contacts/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/contacts/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
