import type { ApiRequestFn } from '../request.js';
import type {
	ApiEntityTag,
	ApiTag,
	ApiTagCreateBody,
	ApiTagListParams,
	ApiTagUpdateBody
} from '../types.js';
import type { TagsEndpoints } from './types.js';

const ENTITY_PATH: Record<'contact' | 'lead' | 'client', string> = {
	contact: 'contacts',
	lead: 'leads',
	client: 'clients'
};

export function createTagsEndpoints(request: ApiRequestFn): TagsEndpoints {
	return {
		list: async (params: ApiTagListParams = {}, signal) => {
			return request<ApiTag[]>('/api/v1/tags', {
				orgScoped: true,
				query: { limit: params.limit },
				signal
			});
		},
		create: async (body: ApiTagCreateBody, signal) => {
			const { data } = await request<ApiTag>('/api/v1/tags', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiTag>(`/api/v1/tags/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiTagUpdateBody, version, signal) => {
			const { data } = await request<ApiTag>(`/api/v1/tags/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/tags/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		listForEntity: async (entityType, entityId, signal) => {
			const path = ENTITY_PATH[entityType];
			return request<ApiEntityTag[]>(`/api/v1/${path}/${entityId}/tags`, {
				orgScoped: true,
				signal
			});
		},
		replaceForEntity: async (entityType, entityId, tagIds, signal) => {
			const path = ENTITY_PATH[entityType];
			const { data } = await request<ApiEntityTag[]>(`/api/v1/${path}/${entityId}/tags`, {
				method: 'PUT',
				body: { tag_ids: tagIds },
				orgScoped: true,
				signal
			});
			return data;
		}
	};
}
