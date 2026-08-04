import type { ApiRequestFn } from '../request.js';
import type {
	ApiMeeting,
	ApiMeetingCreateBody,
	ApiMeetingDocument,
	ApiMeetingListParams,
	ApiMeetingTranscriptAttachBody,
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
					upcoming: params.upcoming,
					starts_after: params.starts_after,
					starts_before: params.starts_before,
					entity_type: params.entity_type,
					entity_id: params.entity_id
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
		},
		attachTranscript: async (
			id,
			body: ApiMeetingTranscriptAttachBody,
			version,
			signal
		) => {
			const { data } = await request<ApiMeetingDocument>(
				`/api/v1/meetings/${id}/transcript`,
				{
					method: 'POST',
					body,
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		generateSummary: async (id, version, signal) => {
			const { data } = await request<ApiMeetingDocument>(
				`/api/v1/meetings/${id}/generate-summary`,
				{
					method: 'POST',
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		acceptTaskProposal: async (meetingId, proposalId, version, signal) => {
			const { data } = await request<ApiMeetingDocument>(
				`/api/v1/meetings/${meetingId}/task-proposals/${proposalId}/accept`,
				{
					method: 'POST',
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		dismissTaskProposal: async (meetingId, proposalId, version, signal) => {
			const { data } = await request<ApiMeetingDocument>(
				`/api/v1/meetings/${meetingId}/task-proposals/${proposalId}/dismiss`,
				{
					method: 'POST',
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		}
	};
}
