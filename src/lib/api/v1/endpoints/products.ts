import type { ApiRequestFn } from '../request.js';
import type {
	ApiProduct,
	ApiProductAdjustStockBody,
	ApiProductCreateBody,
	ApiProductListParams,
	ApiProductUpdateBody
} from '../types.js';
import type { ProductsEndpoints } from './types.js';

export function createProductsEndpoints(request: ApiRequestFn): ProductsEndpoints {
	return {
		list: async (params: ApiProductListParams = {}, signal) => {
			return request<ApiProduct[]>('/api/v1/products', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					status: params.status
				},
				signal
			});
		},
		create: async (body: ApiProductCreateBody, signal) => {
			const { data } = await request<ApiProduct>('/api/v1/products', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiProduct>(`/api/v1/products/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiProductUpdateBody, version, signal) => {
			const { data } = await request<ApiProduct>(`/api/v1/products/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/products/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		adjustStock: async (id, body: ApiProductAdjustStockBody, signal) => {
			const idempotencyKey =
				typeof crypto !== 'undefined' && 'randomUUID' in crypto
					? crypto.randomUUID()
					: `adjust-${Date.now()}`;
			const { data } = await request<ApiProduct>(`/api/v1/products/${id}/adjust-stock`, {
				method: 'POST',
				body,
				orgScoped: true,
				headers: { 'Idempotency-Key': idempotencyKey },
				signal
			});
			return data;
		}
	};
}
