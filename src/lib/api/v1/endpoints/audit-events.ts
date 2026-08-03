import type { ApiRequestFn } from '../request.js';
import type { ApiAuditEvent, ApiAuditEventListParams } from '../types.js';
import type { AuditEventsEndpoints } from './types.js';

export function createAuditEventsEndpoints(request: ApiRequestFn): AuditEventsEndpoints {
	return {
		list: async (params: ApiAuditEventListParams = {}, signal) => {
			return request<ApiAuditEvent[]>('/api/v1/audit-events', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					from: params.from,
					to: params.to,
					action: params.action,
					actor_id: params.actor_id
				},
				signal
			});
		}
	};
}
