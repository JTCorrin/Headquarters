import type { MembershipRole, ThemeOption } from '$lib/schemas/organisation.js';

export interface ApiOrganisationSummary {
	id: string;
	name: string;
	slug: string;
	logo_path: string | null;
	default_currency: string;
	timezone: string;
	locale: string;
	country_code: string;
	theme_default: ThemeOption;
	version?: number;
}

export interface ApiMembershipSummary {
	id: string;
	role: MembershipRole;
	status: string;
	joined_at: string | null;
}

export interface ApiOrganisationMembership {
	membership: ApiMembershipSummary;
	organisation: ApiOrganisationSummary;
}

export interface ApiOrganisationCreateBody {
	name: string;
	slug: string;
	country_code: string;
	default_currency: string;
	timezone: string;
	locale: string;
}

export interface ApiOrganisationCreateResult {
	organisation: ApiOrganisationSummary;
	membership: ApiMembershipSummary;
}

export interface ApiOrganisationConfiguration {
	id: string;
	name: string;
	legal_name: string | null;
	slug: string;
	logo_path: string | null;
	billing_email: string | null;
	phone: string | null;
	website_url: string | null;
	tax_identifier: string | null;
	registration_number: string | null;
	default_currency: string;
	timezone: string;
	locale: string;
	country_code: string;
	theme_default: ThemeOption;
	settings: unknown;
	version: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export type ApiOrganisationConfigurationPatch = Partial<{
	name: string;
	legal_name: string | null;
	logo_path: string | null;
	billing_email: string | null;
	phone: string | null;
	website_url: string | null;
	tax_identifier: string | null;
	registration_number: string | null;
	default_currency: string;
	timezone: string;
	locale: string;
	country_code: string;
	theme_default: ThemeOption;
	settings: unknown;
}>;

export interface ApiTaxRate {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	name: string;
	rate_percent: number;
	is_default: boolean;
	active: boolean;
}

export interface ApiTaxRateCreateBody {
	name: string;
	rate_percent: number;
	is_default?: boolean;
	active?: boolean;
}

export type ApiTaxRatePatchBody = Partial<ApiTaxRateCreateBody>;

export interface ApiProfilePreferences {
	theme_preference: ThemeOption | null;
	locale: string | null;
	timezone: string | null;
}

export interface ApiProfilePreferencesPatch {
	theme_preference: ThemeOption | null;
}

export interface ApiEnvelope<T> {
	data: T;
}

export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
		fields?: Record<string, string>;
		request_id?: string;
	};
}
