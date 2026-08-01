import type { ApiResult } from '../request.js';
import type {
	ApiOrganisationConfiguration,
	ApiOrganisationConfigurationPatch,
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrganisationMembership,
	ApiProfilePreferences,
	ApiProfilePreferencesPatch,
	ApiQuote,
	ApiQuoteCreateBody,
	ApiQuoteDocument,
	ApiQuoteListParams,
	ApiQuoteUpdateBody,
	ApiTaxRate,
	ApiTaxRateCreateBody,
	ApiTaxRateListParams,
	ApiTaxRatePatchBody
} from '../types.js';

export interface OrganisationsEndpoints {
	list(signal?: AbortSignal): Promise<ApiOrganisationMembership[]>;
	create(body: ApiOrganisationCreateBody, signal?: AbortSignal): Promise<ApiOrganisationCreateResult>;
}

export interface OrganisationConfigEndpoints {
	get(signal?: AbortSignal): Promise<ApiOrganisationConfiguration>;
	update(
		body: ApiOrganisationConfigurationPatch,
		version: number,
		signal?: AbortSignal
	): Promise<ApiOrganisationConfiguration>;
}

export interface TaxRatesEndpoints {
	list(params?: ApiTaxRateListParams, signal?: AbortSignal): Promise<ApiTaxRate[]>;
	create(body: ApiTaxRateCreateBody, signal?: AbortSignal): Promise<ApiTaxRate>;
	update(
		id: string,
		body: ApiTaxRatePatchBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiTaxRate>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}

export interface ProfilePreferencesEndpoints {
	get(signal?: AbortSignal): Promise<ApiProfilePreferences>;
	update(body: ApiProfilePreferencesPatch, signal?: AbortSignal): Promise<ApiProfilePreferences>;
}

export interface QuotesEndpoints {
	list(
		params?: ApiQuoteListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiQuote[]>>;
	create(body: ApiQuoteCreateBody, signal?: AbortSignal): Promise<ApiQuoteDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiQuoteDocument>>;
	update(
		id: string,
		body: ApiQuoteUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiQuoteDocument>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}
