import type { ApiRequestFn } from '../request.js';
import type {
	ApiBill,
	ApiBillCreateBody,
	ApiBillDocument,
	ApiBillListParams,
	ApiBillUpdateBody,
	ApiBillVoidBody
} from '../types.js';
import type { BillsEndpoints } from './types.js';

export function createBillsEndpoints(request: ApiRequestFn): BillsEndpoints {
	return {
		list: async (params: ApiBillListParams = {}, signal) => {
			return request<ApiBill[]>('/api/v1/bills', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					status: params.status,
					vendor_id: params.vendor_id
				},
				signal
			});
		},
		create: async (body: ApiBillCreateBody, signal) => {
			const { data } = await request<ApiBillDocument>('/api/v1/bills', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiBillDocument>(`/api/v1/bills/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiBillUpdateBody, version, signal) => {
			const { data } = await request<ApiBillDocument>(`/api/v1/bills/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/bills/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		receive: async (id, version, signal) => {
			const { data } = await request<ApiBillDocument>(`/api/v1/bills/${id}/receive`, {
				method: 'POST',
				body: {},
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		void: async (id, body: ApiBillVoidBody, version, signal) => {
			const { data } = await request<ApiBillDocument>(`/api/v1/bills/${id}/void`, {
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
