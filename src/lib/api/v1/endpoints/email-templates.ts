import type { ApiRequestFn } from '../request.js';
import type {
	ApiEmailTemplate,
	ApiEmailTemplateCreateBody,
	ApiEmailTemplateListParams,
	ApiEmailTemplateUpdateBody
} from '../types.js';
import type { EmailTemplatesEndpoints } from './types.js';

export function createEmailTemplatesEndpoints(request: ApiRequestFn): EmailTemplatesEndpoints {
	return {
		list: async (params: ApiEmailTemplateListParams = {}, signal) => {
			return request<ApiEmailTemplate[]>('/api/v1/email-templates', {
				orgScoped: true,
				query: {
					limit: params.limit,
					status: params.status,
					category: params.category
				},
				signal
			});
		},
		create: async (body: ApiEmailTemplateCreateBody, signal) => {
			const { data } = await request<ApiEmailTemplate>('/api/v1/email-templates', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiEmailTemplate>(`/api/v1/email-templates/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiEmailTemplateUpdateBody, version, signal) => {
			const { data } = await request<ApiEmailTemplate>(`/api/v1/email-templates/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/email-templates/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
