import type { ApiRequestFn } from '../request.js';
import type { ApiDashboardSummary } from '../types.js';
import type { DashboardEndpoints } from './types.js';

export function createDashboardEndpoints(request: ApiRequestFn): DashboardEndpoints {
	return {
		summary: async (signal) => {
			const { data } = await request<ApiDashboardSummary>('/api/v1/dashboard/summary', {
				orgScoped: true,
				signal
			});
			return data;
		}
	};
}
