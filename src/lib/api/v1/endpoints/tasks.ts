import type { ApiRequestFn } from '../request.js';
import type {
	ApiTask,
	ApiTaskCreateBody,
	ApiTaskListParams,
	ApiTaskUpdateBody
} from '../types.js';
import type { TasksEndpoints } from './types.js';

export function createTasksEndpoints(request: ApiRequestFn): TasksEndpoints {
	return {
		list: async (params: ApiTaskListParams = {}, signal) => {
			return request<ApiTask[]>('/api/v1/tasks', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					status: params.status,
					assignee: params.assignee,
					entity_type: params.entity_type,
					entity_id: params.entity_id,
					meeting_id: params.meeting_id,
					project_card_id: params.project_card_id
				},
				signal
			});
		},
		create: async (body: ApiTaskCreateBody, signal) => {
			const { data } = await request<ApiTask>('/api/v1/tasks', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiTask>(`/api/v1/tasks/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiTaskUpdateBody, version, signal) => {
			const { data } = await request<ApiTask>(`/api/v1/tasks/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/tasks/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
