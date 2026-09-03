import type { ApiRequestFn } from '../request.js';
import type { ApiOrgMailbox } from '../types.js';
import type { OrgMailboxesEndpoints } from './types.js';

export function createOrgMailboxesEndpoints(request: ApiRequestFn): OrgMailboxesEndpoints {
	return {
		list: async (signal) => {
			return request<ApiOrgMailbox[]>('/api/v1/organisation/mailboxes', {
				orgScoped: true,
				signal
			});
		}
	};
}
