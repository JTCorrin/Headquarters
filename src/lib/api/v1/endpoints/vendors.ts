import type { ApiRequestFn } from '../request.js';
import type {
	ApiVendor,
	ApiVendorCreateBody,
	ApiVendorListParams,
	ApiVendorUpdateBody
} from '../types.js';
import type { VendorsEndpoints } from './types.js';

export function createVendorsEndpoints(request: ApiRequestFn): VendorsEndpoints {
	return {
		list: async (params: ApiVendorListParams = {}, signal) => {
			return request<ApiVendor[]>('/api/v1/vendors', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor
				},
				signal
			});
		},
		create: async (body: ApiVendorCreateBody, signal) => {
			const { data } = await request<ApiVendor>('/api/v1/vendors', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiVendor>(`/api/v1/vendors/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiVendorUpdateBody, version, signal) => {
			const { data } = await request<ApiVendor>(`/api/v1/vendors/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		}
	};
}
