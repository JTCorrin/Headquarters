import type { ApiRequestFn } from '../request.js';
import type {
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrganisationMembership
} from '../types.js';
import type { OrganisationsEndpoints } from './types.js';

export function createOrganisationsEndpoints(request: ApiRequestFn): OrganisationsEndpoints {
	return {
		list: async (signal) => {
			const { data } = await request<ApiOrganisationMembership[]>('/api/v1/organisations', {
				orgScoped: false,
				signal
			});
			return data;
		},
		create: async (body: ApiOrganisationCreateBody, signal) => {
			const { data } = await request<ApiOrganisationCreateResult>('/api/v1/organisations', {
				method: 'POST',
				body,
				orgScoped: false,
				signal
			});
			return data;
		}
	};
}
