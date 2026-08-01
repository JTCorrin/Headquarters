import type { ApiRequestFn } from '../request.js';
import type {
	ApiLead,
	ApiLeadConvertBody,
	ApiLeadConvertResult,
	ApiLeadCreateBody,
	ApiLeadListParams,
	ApiLeadUpdateBody
} from '../types.js';
import type { LeadsEndpoints } from './types.js';

export function createLeadsEndpoints(request: ApiRequestFn): LeadsEndpoints {
	return {
		list: async (params: ApiLeadListParams = {}, signal) => {
			return request<ApiLead[]>('/api/v1/leads', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					stage: params.stage
				},
				signal
			});
		},
		create: async (body: ApiLeadCreateBody, signal) => {
			const { data } = await request<ApiLead>('/api/v1/leads', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiLead>(`/api/v1/leads/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiLeadUpdateBody, version, signal) => {
			const { data } = await request<ApiLead>(`/api/v1/leads/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/leads/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		convert: async (id, body: ApiLeadConvertBody = {}, signal) => {
			const { data } = await request<ApiLeadConvertResult>(`/api/v1/leads/${id}/convert`, {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		}
	};
}
