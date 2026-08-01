import type { ApiRequestFn } from '../request.js';
import type {
	ApiOrganisationConfiguration,
	ApiOrganisationConfigurationPatch
} from '../types.js';
import type { OrganisationConfigEndpoints } from './types.js';

export function createOrganisationConfigEndpoints(
	request: ApiRequestFn
): OrganisationConfigEndpoints {
	return {
		get: async (signal) => {
			const { data } = await request<ApiOrganisationConfiguration>(
				'/api/v1/organisation/configuration',
				{ orgScoped: true, signal }
			);
			return data;
		},
		update: async (body: ApiOrganisationConfigurationPatch, version, signal) => {
			const { data } = await request<ApiOrganisationConfiguration>(
				'/api/v1/organisation/configuration',
				{
					method: 'PATCH',
					body,
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		}
	};
}
