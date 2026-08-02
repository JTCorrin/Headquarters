import type { ApiRequestFn } from '../request.js';
import type { ApiMailboxAccount, ApiMailboxPutBody, ApiMailboxTestResult } from '../types.js';
import type { MailboxEndpoints } from './types.js';

export function createMailboxEndpoints(request: ApiRequestFn): MailboxEndpoints {
	return {
		get: async (signal) => {
			const { data } = await request<ApiMailboxAccount | null>('/api/v1/me/mailbox', {
				orgScoped: true,
				signal
			});
			return data;
		},
		put: async (body: ApiMailboxPutBody, signal) => {
			const { data } = await request<ApiMailboxAccount>('/api/v1/me/mailbox', {
				method: 'PUT',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		test: async (signal) => {
			const { data } = await request<ApiMailboxTestResult>('/api/v1/me/mailbox/test', {
				method: 'POST',
				orgScoped: true,
				signal
			});
			return data;
		},
		disconnect: async (signal) => {
			await request<null>('/api/v1/me/mailbox', {
				method: 'DELETE',
				orgScoped: true,
				signal
			});
		}
	};
}
