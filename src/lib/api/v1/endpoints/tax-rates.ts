import type { ApiRequestFn } from '../request.js';
import type {
	ApiTaxRate,
	ApiTaxRateCreateBody,
	ApiTaxRateListParams,
	ApiTaxRatePatchBody
} from '../types.js';
import type { TaxRatesEndpoints } from './types.js';

export function createTaxRatesEndpoints(request: ApiRequestFn): TaxRatesEndpoints {
	return {
		list: async (params: ApiTaxRateListParams = {}, signal) => {
			const { data } = await request<ApiTaxRate[]>('/api/v1/tax-rates', {
				orgScoped: true,
				query: { limit: params.limit ?? 50 },
				signal
			});
			return data;
		},
		create: async (body: ApiTaxRateCreateBody, signal) => {
			const { data } = await request<ApiTaxRate>('/api/v1/tax-rates', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		update: async (id, body: ApiTaxRatePatchBody, version, signal) => {
			const { data } = await request<ApiTaxRate>(`/api/v1/tax-rates/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/tax-rates/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
