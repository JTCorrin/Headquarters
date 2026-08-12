import type { ApiRequestFn } from '../request.js';
import type {
	ApiOrganisationBranding,
	ApiOrganisationConfiguration,
	ApiOrganisationConfigurationPatch,
	ApiOrganisationLogoFinalizeBody,
	ApiOrganisationLogoUploadIntent,
	ApiOrganisationLogoUploadIntentBody
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
		},
		getBranding: async (signal) => {
			const { data } = await request<ApiOrganisationBranding>(
				'/api/v1/organisation/branding',
				{ orgScoped: true, signal }
			);
			return data;
		},
		createLogoUploadIntent: async (body: ApiOrganisationLogoUploadIntentBody, signal) => {
			const { data } = await request<ApiOrganisationLogoUploadIntent>(
				'/api/v1/organisation/logo/upload-intent',
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		finalizeLogo: async (body: ApiOrganisationLogoFinalizeBody, version, signal) => {
			const { data } = await request<ApiOrganisationConfiguration>(
				'/api/v1/organisation/logo/finalize',
				{
					method: 'POST',
					body,
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		deleteLogo: async (version, signal) => {
			const { data } = await request<ApiOrganisationConfiguration>(
				'/api/v1/organisation/logo',
				{
					method: 'DELETE',
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		}
	};
}
