import type { ApiRequestFn } from '../request.js';
import type {
	ApiQuote,
	ApiQuoteCreateBody,
	ApiQuoteDocument,
	ApiQuoteListParams,
	ApiQuoteUpdateBody
} from '../types.js';
import type { QuotesEndpoints } from './types.js';

export function createQuotesEndpoints(request: ApiRequestFn): QuotesEndpoints {
	return {
		list: async (params: ApiQuoteListParams = {}, signal) => {
			return request<ApiQuote[]>('/api/v1/quotes', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					status: params.status,
					client_id: params.client_id
				},
				signal
			});
		},
		create: async (body: ApiQuoteCreateBody, signal) => {
			const { data } = await request<ApiQuoteDocument>('/api/v1/quotes', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiQuoteDocument>(`/api/v1/quotes/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiQuoteUpdateBody, version, signal) => {
			const { data } = await request<ApiQuoteDocument>(`/api/v1/quotes/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/quotes/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		accept: async (id, version, signal) => {
			const { data } = await request<ApiQuoteDocument>(`/api/v1/quotes/${id}/accept`, {
				method: 'POST',
				body: {},
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		send: async (id, version, signal) => {
			const { data } = await request<ApiQuoteDocument>(`/api/v1/quotes/${id}/send`, {
				method: 'POST',
				body: {},
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		reject: async (id, version, signal) => {
			const { data } = await request<ApiQuoteDocument>(`/api/v1/quotes/${id}/reject`, {
				method: 'POST',
				body: {},
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		}
	};
}
