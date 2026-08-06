import type { ApiRequestFn } from '../request.js';
import type {
	ApiAiIntegration,
	ApiAiIntegrationConnectBody,
	ApiAiPrompts,
	ApiAiPromptsUpdateBody,
	ApiAiProvider
} from '../types.js';
import type { IntegrationsEndpoints } from './types.js';

export function createIntegrationsEndpoints(request: ApiRequestFn): IntegrationsEndpoints {
	return {
		list: async (signal) => {
			const { data } = await request<ApiAiIntegration[]>('/api/v1/integrations', {
				orgScoped: true,
				signal
			});
			return data;
		},
		connectAi: async (provider: ApiAiProvider, body: ApiAiIntegrationConnectBody, signal) => {
			const { data } = await request<ApiAiIntegration>(
				`/api/v1/integrations/ai/${provider}`,
				{
					method: 'PUT',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		disconnectAi: async (provider: ApiAiProvider, signal) => {
			await request<null>(`/api/v1/integrations/ai/${provider}`, {
				method: 'DELETE',
				orgScoped: true,
				signal
			});
		},
		getAiPrompts: async (signal) => {
			const { data } = await request<ApiAiPrompts>('/api/v1/integrations/ai/prompts', {
				orgScoped: true,
				signal
			});
			return data;
		},
		updateAiPrompts: async (body: ApiAiPromptsUpdateBody, signal) => {
			const { data } = await request<ApiAiPrompts>('/api/v1/integrations/ai/prompts', {
				method: 'PUT',
				body,
				orgScoped: true,
				signal
			});
			return data;
		}
	};
}
