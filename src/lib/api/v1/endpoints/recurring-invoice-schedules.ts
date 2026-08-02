import type { ApiRequestFn } from '../request.js';
import type {
	ApiRecurringInvoiceCreateBody,
	ApiRecurringInvoiceDocument,
	ApiRecurringInvoiceListParams,
	ApiRecurringInvoicePreviewBody,
	ApiRecurringInvoicePreviewResult,
	ApiRecurringInvoiceRun,
	ApiRecurringInvoiceRunDocument,
	ApiRecurringInvoiceSchedule,
	ApiRecurringInvoiceUpdateBody
} from '../types.js';
import type { RecurringInvoiceSchedulesEndpoints } from './types.js';

function newIdempotencyKey(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `cmd-${Date.now()}`;
}

export function createRecurringInvoiceSchedulesEndpoints(
	request: ApiRequestFn
): RecurringInvoiceSchedulesEndpoints {
	return {
		list: async (params: ApiRecurringInvoiceListParams = {}, signal) => {
			return request<ApiRecurringInvoiceSchedule[]>('/api/v1/recurring-invoice-schedules', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					status: params.status
				},
				signal
			});
		},
		create: async (body: ApiRecurringInvoiceCreateBody, signal) => {
			const { data } = await request<ApiRecurringInvoiceDocument>(
				'/api/v1/recurring-invoice-schedules',
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		get: async (id, signal) => {
			return request<ApiRecurringInvoiceDocument>(
				`/api/v1/recurring-invoice-schedules/${id}`,
				{
					orgScoped: true,
					signal
				}
			);
		},
		update: async (id, body: ApiRecurringInvoiceUpdateBody, version, signal) => {
			const { data } = await request<ApiRecurringInvoiceDocument>(
				`/api/v1/recurring-invoice-schedules/${id}`,
				{
					method: 'PATCH',
					body,
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/recurring-invoice-schedules/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		preview: async (body: ApiRecurringInvoicePreviewBody, signal) => {
			const { data } = await request<ApiRecurringInvoicePreviewResult>(
				'/api/v1/recurring-invoice-schedules/preview',
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		listRuns: async (id, params = {}, signal) => {
			return request<ApiRecurringInvoiceRun[]>(
				`/api/v1/recurring-invoice-schedules/${id}/runs`,
				{
					orgScoped: true,
					query: {
						limit: params.limit,
						cursor: params.cursor
					},
					signal
				}
			);
		},
		getRun: async (scheduleId, runId, signal) => {
			return request<ApiRecurringInvoiceRunDocument>(
				`/api/v1/recurring-invoice-schedules/${scheduleId}/runs/${runId}`,
				{
					orgScoped: true,
					signal
				}
			);
		},
		activate: async (id, version, signal) => {
			const { data } = await request<ApiRecurringInvoiceDocument>(
				`/api/v1/recurring-invoice-schedules/${id}/activate`,
				{
					method: 'POST',
					body: {},
					orgScoped: true,
					ifMatchVersion: version,
					headers: { 'Idempotency-Key': newIdempotencyKey() },
					signal
				}
			);
			return data;
		},
		pause: async (id, version, signal) => {
			const { data } = await request<ApiRecurringInvoiceDocument>(
				`/api/v1/recurring-invoice-schedules/${id}/pause`,
				{
					method: 'POST',
					body: {},
					orgScoped: true,
					ifMatchVersion: version,
					headers: { 'Idempotency-Key': newIdempotencyKey() },
					signal
				}
			);
			return data;
		},
		resume: async (id, version, signal) => {
			const { data } = await request<ApiRecurringInvoiceDocument>(
				`/api/v1/recurring-invoice-schedules/${id}/resume`,
				{
					method: 'POST',
					body: {},
					orgScoped: true,
					ifMatchVersion: version,
					headers: { 'Idempotency-Key': newIdempotencyKey() },
					signal
				}
			);
			return data;
		},
		cancel: async (id, version, signal) => {
			const { data } = await request<ApiRecurringInvoiceDocument>(
				`/api/v1/recurring-invoice-schedules/${id}/cancel`,
				{
					method: 'POST',
					body: {},
					orgScoped: true,
					ifMatchVersion: version,
					headers: { 'Idempotency-Key': newIdempotencyKey() },
					signal
				}
			);
			return data;
		},
		runNow: async (id, version, signal) => {
			const { data } = await request<ApiRecurringInvoiceRunDocument>(
				`/api/v1/recurring-invoice-schedules/${id}/run-now`,
				{
					method: 'POST',
					body: {},
					orgScoped: true,
					ifMatchVersion: version,
					headers: { 'Idempotency-Key': newIdempotencyKey() },
					signal
				}
			);
			return data;
		}
	};
}
