import type {
	MembershipRole,
	OrganisationConfigData,
	OrganisationConfigResource,
	OrganisationCreateData,
	OrgMembershipSummary,
	ProfilePreferencesData,
	TaxRateFormData,
	TaxRateResource,
	ThemeOption,
	ThemePreferenceOption
} from '$lib/schemas/organisation.js';
import type {
	ApiOrganisationConfiguration,
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrganisationMembership,
	ApiProfilePreferences,
	ApiTaxRate,
	ApiTaxRateCreateBody
} from './types.js';

export function toOrgMembershipSummary(
	row: ApiOrganisationMembership
): OrgMembershipSummary {
	return {
		org_id: row.organisation.id,
		org_name: row.organisation.name,
		org_slug: row.organisation.slug,
		logo_url: row.organisation.logo_path,
		role: row.membership.role
	};
}

export function membershipFromCreateResult(
	result: ApiOrganisationCreateResult
): OrgMembershipSummary {
	return {
		org_id: result.organisation.id,
		org_name: result.organisation.name,
		org_slug: result.organisation.slug,
		logo_url: result.organisation.logo_path,
		role: result.membership.role
	};
}

export function toOrganisationCreateBody(
	data: OrganisationCreateData
): ApiOrganisationCreateBody {
	return {
		name: data.name,
		slug: data.slug,
		country_code: data.country,
		default_currency: data.currency,
		timezone: data.timezone,
		locale: data.locale
	};
}

export function toOrganisationConfigResource(
	config: ApiOrganisationConfiguration
): OrganisationConfigResource {
	return {
		id: config.id,
		version: config.version,
		name: config.name,
		slug: config.slug,
		timezone: config.timezone,
		default_currency: config.default_currency,
		locale: config.locale,
		country_code: config.country_code,
		theme_default: config.theme_default
	};
}

export function toOrganisationConfigFormData(
	config: ApiOrganisationConfiguration
): OrganisationConfigData {
	return {
		timezone: config.timezone,
		currency: config.default_currency,
		locale: config.locale,
		themeDefault: config.theme_default
	};
}

export function toOrganisationConfigPatch(data: OrganisationConfigData) {
	return {
		timezone: data.timezone,
		default_currency: data.currency,
		locale: data.locale,
		theme_default: data.themeDefault
	};
}

export function toTaxRateResource(rate: ApiTaxRate): TaxRateResource {
	return {
		id: rate.id,
		version: rate.version,
		name: rate.name,
		rate_percent: rate.rate_percent,
		is_default: rate.is_default,
		active: rate.active
	};
}

export function toTaxRateCreateBody(data: TaxRateFormData): ApiTaxRateCreateBody {
	return {
		name: data.name,
		rate_percent: Number(data.ratePercent),
		is_default: data.isDefault === 'true',
		active: data.active === 'true'
	};
}

export function themePreferenceToApi(
	value: ThemePreferenceOption
): ThemeOption | null {
	return value === 'org_default' ? null : value;
}

export function themePreferenceFromApi(
	value: ThemeOption | null | undefined
): ThemePreferenceOption {
	return value ?? 'org_default';
}

export function toProfilePreferencesFormData(
	prefs: ApiProfilePreferences
): ProfilePreferencesData {
	return {
		themePreference: themePreferenceFromApi(prefs.theme_preference)
	};
}

export function roleFromMemberships(
	memberships: OrgMembershipSummary[],
	orgId: string | null
): MembershipRole | null {
	if (!orgId) return null;
	return memberships.find((m) => m.org_id === orgId)?.role ?? null;
}
