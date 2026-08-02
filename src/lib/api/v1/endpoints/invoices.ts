import type { ApiRequestFn } from '../request.js';
import type {
	ApiInvoice,
	ApiInvoiceCreateBody,
	ApiInvoiceDocument,
	ApiInvoiceListParams,
	ApiInvoiceUpdateBody,
	ApiInvoiceVoidBody
} from '../types.js';
import type { InvoicesEndpoints } from './types.js';

export function createInvoicesEndpoints(request: ApiRequestFn): InvoicesEndpoints {
	return {
		list: async (params: ApiInvoiceListParams = {}, signal) => {
			return request<ApiInvoice[]>('/api/v1/invoices', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					status: params.status
				},
				signal
			});
		},
		create: async (body: ApiInvoiceCreateBody, signal) => {
			const { data } = await request<ApiInvoiceDocument>('/api/v1/invoices', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiInvoiceDocument>(`/api/v1/invoices/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiInvoiceUpdateBody, version, signal) => {
			const { data } = await request<ApiInvoiceDocument>(`/api/v1/invoices/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/invoices/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		send: async (id, version, signal) => {
			const { data } = await request<ApiInvoiceDocument>(`/api/v1/invoices/${id}/send`, {
				method: 'POST',
				body: {},
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		void: async (id, body: ApiInvoiceVoidBody, version, signal) => {
			const { data } = await request<ApiInvoiceDocument>(`/api/v1/invoices/${id}/void`, {
				method: 'POST',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		}
	};
}
