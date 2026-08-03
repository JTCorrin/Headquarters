import type { ApiRequestFn } from '../request.js';
import type {
	ApiProject,
	ApiProjectCard,
	ApiProjectCardCreateBody,
	ApiProjectCardUpdateBody,
	ApiProjectCreateBody,
	ApiProjectDocument,
	ApiProjectListParams,
	ApiProjectUpdateBody
} from '../types.js';
import type { ProjectsEndpoints } from './types.js';

export function createProjectsEndpoints(request: ApiRequestFn): ProjectsEndpoints {
	return {
		list: async (params: ApiProjectListParams = {}, signal) => {
			return request<ApiProject[]>('/api/v1/projects', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					client_id: params.client_id,
					status: params.status
				},
				signal
			});
		},
		create: async (body: ApiProjectCreateBody, signal) => {
			const { data } = await request<ApiProjectDocument>('/api/v1/projects', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiProjectDocument>(`/api/v1/projects/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiProjectUpdateBody, version, signal) => {
			const { data } = await request<ApiProjectDocument>(`/api/v1/projects/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/projects/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		createCard: async (projectId, body: ApiProjectCardCreateBody, signal) => {
			const { data } = await request<ApiProjectCard>(`/api/v1/projects/${projectId}/cards`, {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		updateCard: async (
			projectId,
			cardId,
			body: ApiProjectCardUpdateBody,
			version,
			signal
		) => {
			const { data } = await request<ApiProjectCard>(
				`/api/v1/projects/${projectId}/cards/${cardId}`,
				{
					method: 'PATCH',
					body,
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		deleteCard: async (projectId, cardId, version, signal) => {
			await request<undefined>(`/api/v1/projects/${projectId}/cards/${cardId}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
