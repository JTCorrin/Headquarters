import type { ApiRequestFn } from '../request.js';
import type {
	ApiMailboxAccount,
	ApiMailboxOAuthProvider,
	ApiMailboxOAuthStart,
	ApiMailboxPutBody,
	ApiMailboxSyncResult,
	ApiMailboxTestResult
} from '../types.js';
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
		sync: async (signal) => {
			const { data } = await request<ApiMailboxSyncResult>('/api/v1/me/mailbox/sync', {
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
		},
		startOAuth: async (provider: ApiMailboxOAuthProvider, signal) => {
			const { data } = await request<ApiMailboxOAuthStart>(
				`/api/v1/me/mailbox/oauth/start?provider=${encodeURIComponent(provider)}`,
				{
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		completeOAuth: async (body, signal) => {
			const { data } = await request<ApiMailboxAccount>('/api/v1/me/mailbox/oauth/callback', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		}
	};
}
