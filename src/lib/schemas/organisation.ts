import { z } from 'zod';

export const membershipRoles = [
	'owner',
	'admin',
	'member',
	'billing',
	'readonly'
] as const;

export type MembershipRole = (typeof membershipRoles)[number];

export const themeOptions = ['system', 'light', 'dark'] as const;
export type ThemeOption = (typeof themeOptions)[number];

/** Personal preference: concrete theme or inherit active org default. */
export const themePreferenceOptions = [...themeOptions, 'org_default'] as const;
export type ThemePreferenceOption = (typeof themePreferenceOptions)[number];

/** True when the runtime Intl engine recognizes the zone (canonical + aliases like US/Eastern, Etc/*). */
export function isIanaTimezone(value: string): boolean {
	if (!value) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

const ianaTimezone = z
	.string()
	.trim()
	.min(1, 'Timezone is required')
	.max(64)
	.refine((value) => isIanaTimezone(value), 'Must be a valid IANA timezone');

const currencyCode = z
	.string()
	.trim()
	.regex(/^[A-Z]{3}$/, 'Use a 3-letter uppercase currency code');

const localeTag = z
	.string()
	.trim()
	.min(2, 'Locale is required')
	.max(35)
	.refine((value) => /^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(value), 'Use a BCP 47 locale');

const countryCode = z
	.string()
	.trim()
	.regex(/^[A-Z]{2}$/, 'Use a 2-letter uppercase country code');

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyOrganisationName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63);
}

/**
 * Display names used in Superforms SPA validators.
 * Do **not** use Zod `.trim()` here — Superforms applies the schema while typing and
 * would strip a trailing space, making multi-word names impossible to enter.
 * Trim at the API mapper / server boundary instead.
 */
function requiredDisplayName(max: number) {
	return z
		.string()
		.min(1, 'Name is required')
		.max(max)
		.refine((value) => value.trim().length > 0, 'Name is required');
}

export const organisationCreateSchema = z.object({
	name: requiredDisplayName(200),
	slug: z
		.string()
		.trim()
		.min(2, 'Slug must be at least 2 characters')
		.max(63)
		.regex(slugPattern, 'Use lowercase letters, numbers, and hyphens'),
	timezone: ianaTimezone,
	currency: currencyCode,
	locale: localeTag,
	country: countryCode
});

export type OrganisationCreateSchema = typeof organisationCreateSchema;
export type OrganisationCreateData = z.infer<typeof organisationCreateSchema>;

export const organisationConfigSchema = z.object({
	timezone: ianaTimezone,
	currency: currencyCode,
	locale: localeTag,
	themeDefault: z.enum(themeOptions)
});

export type OrganisationConfigSchema = typeof organisationConfigSchema;
export type OrganisationConfigData = z.infer<typeof organisationConfigSchema>;

const ratePercentString = z
	.string()
	.trim()
	.min(1, 'Rate is required')
	.refine((value) => /^\d+(\.\d{1,4})?$/.test(value), 'Use 0–100 with up to 4 decimals')
	.refine((value) => {
		const n = Number(value);
		return Number.isFinite(n) && n >= 0 && n <= 100;
	}, 'Rate must be between 0 and 100');

export const taxRateFormSchema = z
	.object({
		name: requiredDisplayName(120),
		ratePercent: ratePercentString,
		isDefault: z.enum(['true', 'false']),
		active: z.enum(['true', 'false'])
	})
	.superRefine((value, ctx) => {
		if (value.isDefault === 'true' && value.active === 'false') {
			ctx.addIssue({
				code: 'custom',
				path: ['active'],
				message: 'Default tax rate must remain active'
			});
		}
	});

export type TaxRateFormSchema = typeof taxRateFormSchema;
export type TaxRateFormData = z.infer<typeof taxRateFormSchema>;

export const profilePreferencesSchema = z.object({
	themePreference: z.enum(themePreferenceOptions)
});

export type ProfilePreferencesSchema = typeof profilePreferencesSchema;
export type ProfilePreferencesData = z.infer<typeof profilePreferencesSchema>;

export interface OrgMembershipSummary {
	org_id: string;
	org_name: string;
	org_slug: string;
	logo_url?: string | null;
	role: MembershipRole;
	/** Organisation default theme — used to apply appearance when personal pref is org_default. */
	theme_default: ThemeOption;
}

export interface OrganisationConfigResource {
	id: string;
	version: number;
	name: string;
	slug: string;
	timezone: string;
	default_currency: string;
	locale: string;
	country_code: string;
	theme_default: ThemeOption;
}

export interface TaxRateResource {
	id: string;
	version: number;
	name: string;
	rate_percent: number;
	is_default: boolean;
	active: boolean;
}

export interface ProfilePreferencesResource {
	theme_preference: ThemeOption | null;
}

export function canMutateOrgConfig(role: MembershipRole): boolean {
	return role === 'owner' || role === 'admin';
}

export function roleLabel(role: MembershipRole): string {
	switch (role) {
		case 'owner':
			return 'Owner';
		case 'admin':
			return 'Admin';
		case 'member':
			return 'Member';
		case 'billing':
			return 'Billing';
		case 'readonly':
			return 'Read-only';
	}
}
