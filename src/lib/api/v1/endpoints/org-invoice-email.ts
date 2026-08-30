import { isApiClientError } from '../errors.js';
import type { ApiRequestFn } from '../request.js';
import type {
	ApiOrgInvoiceEmailAccount,
	ApiOrgInvoiceEmailPutBody,
	ApiOrgInvoiceEmailTestResult
} from '../types.js';
import type { OrgInvoiceEmailEndpoints } from './types.js';

export function createOrgInvoiceEmailEndpoints(
	request: ApiRequestFn
): OrgInvoiceEmailEndpoints {
	return {
		get: async (signal) => {
			try {
				const { data } = await request<ApiOrgInvoiceEmailAccount>(
					'/api/v1/organisation/invoice-email',
					{ orgScoped: true, signal }
				);
				return data;
			} catch (error) {
				if (isApiClientError(error) && error.status === 404) return null;
				throw error;
			}
		},
		put: async (body: ApiOrgInvoiceEmailPutBody, signal) => {
			const { data } = await request<ApiOrgInvoiceEmailAccount>(
				'/api/v1/organisation/invoice-email',
				{
					method: 'PUT',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		test: async (signal) => {
			const { data } = await request<ApiOrgInvoiceEmailTestResult>(
				'/api/v1/organisation/invoice-email/test',
				{
					method: 'POST',
					body: {},
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		disconnect: async (signal) => {
			await request<null>('/api/v1/organisation/invoice-email', {
				method: 'DELETE',
				orgScoped: true,
				signal
			});
		}
	};
}
