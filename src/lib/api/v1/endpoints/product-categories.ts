import type { ApiRequestFn } from '../request.js';
import type { ApiProductCategory, ApiProductCategoryListParams } from '../types.js';
import type { ProductCategoriesEndpoints } from './types.js';

export function createProductCategoriesEndpoints(
	request: ApiRequestFn
): ProductCategoriesEndpoints {
	return {
		list: async (params: ApiProductCategoryListParams = {}, signal) => {
			return request<ApiProductCategory[]>('/api/v1/product-categories', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor
				},
				signal
			});
		}
	};
}
