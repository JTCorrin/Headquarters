import type { ApiRequestFn } from '../request.js';
import type { ApiOrgMember } from '../types.js';
import type { OrgMembersEndpoints } from './types.js';

export function createOrgMembersEndpoints(request: ApiRequestFn): OrgMembersEndpoints {
	return {
		list: async (signal) => {
			const { data } = await request<ApiOrgMember[]>('/api/v1/me/org-members', {
				orgScoped: true,
				signal
			});
			return data;
		}
	};
}
