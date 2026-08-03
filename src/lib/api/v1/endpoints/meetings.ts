import type { ApiRequestFn } from '../request.js';
import type {
	ApiMeeting,
	ApiMeetingCreateBody,
	ApiMeetingDocument,
	ApiMeetingListParams,
	ApiMeetingUpdateBody
} from '../types.js';
import type { MeetingsEndpoints } from './types.js';

export function createMeetingsEndpoints(request: ApiRequestFn): MeetingsEndpoints {
	return {
		list: async (params: ApiMeetingListParams = {}, signal) => {
			return request<ApiMeeting[]>('/api/v1/meetings', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					status: params.status,
					upcoming: params.upcoming
				},
				signal
			});
		},
		create: async (body: ApiMeetingCreateBody, signal) => {
			const { data } = await request<ApiMeetingDocument>('/api/v1/meetings', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiMeetingDocument>(`/api/v1/meetings/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiMeetingUpdateBody, version, signal) => {
			const { data } = await request<ApiMeetingDocument>(`/api/v1/meetings/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/meetings/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
