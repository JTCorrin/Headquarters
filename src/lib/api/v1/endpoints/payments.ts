import type { ApiRequestFn } from '../request.js';
import { newIdempotencyKey } from '../idempotency.js';
import type {
	ApiPayment,
	ApiPaymentAllocateBody,
	ApiPaymentCreateBody,
	ApiPaymentDocument,
	ApiPaymentListParams,
	ApiPaymentReverseBody
} from '../types.js';
import type { PaymentsEndpoints } from './types.js';

export function createPaymentsEndpoints(request: ApiRequestFn): PaymentsEndpoints {
	return {
		list: async (params: ApiPaymentListParams = {}, signal) => {
			return request<ApiPayment[]>('/api/v1/payments', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					direction: params.direction,
					client_id: params.client_id,
					vendor_id: params.vendor_id,
					status: params.status,
					invoice_id: params.invoice_id,
					bill_id: params.bill_id
				},
				signal
			});
		},
		create: async (body: ApiPaymentCreateBody, signal) => {
			const { data } = await request<ApiPaymentDocument>('/api/v1/payments', {
				method: 'POST',
				body,
				orgScoped: true,
				headers: { 'Idempotency-Key': newIdempotencyKey() },
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiPaymentDocument>(`/api/v1/payments/${id}`, {
				orgScoped: true,
				signal
			});
		},
		allocate: async (id, body: ApiPaymentAllocateBody, version, signal) => {
			const { data } = await request<ApiPaymentDocument>(`/api/v1/payments/${id}/allocate`, {
				method: 'POST',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				headers: { 'Idempotency-Key': newIdempotencyKey() },
				signal
			});
			return data;
		},
		reverse: async (id, body: ApiPaymentReverseBody, version, signal) => {
			const { data } = await request<ApiPaymentDocument>(`/api/v1/payments/${id}/reverse`, {
				method: 'POST',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				headers: { 'Idempotency-Key': newIdempotencyKey() },
				signal
			});
			return data;
		}
	};
}
