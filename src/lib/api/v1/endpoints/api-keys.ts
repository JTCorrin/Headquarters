import type { ApiRequestFn } from '../request.js';
import type { ApiOrgApiKey, ApiOrgApiKeyCreateBody, ApiOrgApiKeyCreateResult } from '../types.js';
import type { ApiKeysEndpoints } from './types.js';

export function createApiKeysEndpoints(request: ApiRequestFn): ApiKeysEndpoints {
	return {
		list: async (signal) => {
			const { data } = await request<ApiOrgApiKey[]>('/api/v1/api-keys', {
				orgScoped: true,
				signal
			});
			return data;
		},
		create: async (body: ApiOrgApiKeyCreateBody, signal) => {
			const { data } = await request<ApiOrgApiKeyCreateResult>('/api/v1/api-keys', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		revoke: async (id: string, signal) => {
			const { data } = await request<ApiOrgApiKey>(`/api/v1/api-keys/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				signal
			});
			return data;
		}
	};
}
