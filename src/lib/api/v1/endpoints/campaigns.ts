import type { ApiRequestFn } from '../request.js';
import type {
	ApiCampaign,
	ApiCampaignAudiencePreview,
	ApiCampaignCreateBody,
	ApiCampaignListParams,
	ApiCampaignRecipient,
	ApiCampaignUpdateBody
} from '../types.js';
import type { CampaignsEndpoints } from './types.js';

export function createCampaignsEndpoints(request: ApiRequestFn): CampaignsEndpoints {
	return {
		list: async (params: ApiCampaignListParams = {}, signal) => {
			return request<ApiCampaign[]>('/api/v1/campaigns', {
				orgScoped: true,
				query: {
					limit: params.limit,
					status: params.status
				},
				signal
			});
		},
		create: async (body: ApiCampaignCreateBody, signal) => {
			const { data } = await request<ApiCampaign>('/api/v1/campaigns', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiCampaign>(`/api/v1/campaigns/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiCampaignUpdateBody, version, signal) => {
			const { data } = await request<ApiCampaign>(`/api/v1/campaigns/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/campaigns/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		launch: async (id, version, options = {}, signal) => {
			const { data } = await request<ApiCampaign>(`/api/v1/campaigns/${id}/launch`, {
				method: 'POST',
				body: { send_immediately: options.sendImmediately ?? true },
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		cancel: async (id, version, signal) => {
			const { data } = await request<ApiCampaign>(`/api/v1/campaigns/${id}/cancel`, {
				method: 'POST',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		audiencePreview: async (id, body, signal) => {
			const { data } = await request<ApiCampaignAudiencePreview>(
				`/api/v1/campaigns/${id}/audience-preview`,
				{
					method: body ? 'POST' : 'GET',
					body: body ?? undefined,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		listRecipients: async (id, params = {}, signal) => {
			return request<ApiCampaignRecipient[]>(`/api/v1/campaigns/${id}/recipients`, {
				orgScoped: true,
				query: {
					limit: params.limit,
					status: params.status
				},
				signal
			});
		}
	};
}
