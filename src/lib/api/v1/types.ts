import type { MembershipRole, ThemeOption } from '$lib/schemas/organisation.js';

/** Opaque cursor pagination metadata returned by list endpoints. */
export interface ApiListMeta {
	next_cursor?: string | null;
}

export interface ApiEnvelope<T> {
	data: T;
	meta?: ApiListMeta;
}

export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
		fields?: Record<string, string>;
		request_id?: string;
	};
}

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

export type ApiQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'void';

export interface ApiQuote {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	number: string;
	title: string;
	client_id: string | null;
	lead_id: string | null;
	contact_id: string | null;
	owner_membership_id: string | null;
	status: ApiQuoteStatus;
	currency: string;
	issue_on: string;
	valid_until: string | null;
	subtotal_cents: number;
	discount_cents: number;
	tax_cents: number;
	total_cents: number;
	party_snapshot: unknown;
	terms: string | null;
	notes: string | null;
	internal_notes: string | null;
	sent_at: string | null;
	viewed_at: string | null;
	accepted_at: string | null;
	rejected_at: string | null;
	converted_invoice_id: string | null;
}

export interface ApiQuoteLine {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	version: number;
	quote_id: string;
	product_id: string | null;
	sku_snapshot: string | null;
	description: string;
	quantity: number;
	unit_price_cents: number;
	discount_percent: number;
	tax_rate_percent: number;
	subtotal_cents: number;
	tax_cents: number;
	total_cents: number;
	position: number;
}

export type ApiQuoteDocument = ApiQuote & { lines: ApiQuoteLine[] };

export interface ApiQuoteLineInput {
	product_id?: string | null;
	description?: string;
	quantity: number;
	unit_price_cents?: number;
	discount_percent?: number;
	tax_rate_percent?: number;
	position?: number;
}

export interface ApiQuoteCreateBody {
	title: string;
	currency?: string;
	client_id?: string | null;
	lead_id?: string | null;
	contact_id?: string | null;
	owner_membership_id?: string | null;
	issue_on?: string;
	valid_until?: string | null;
	discount_cents?: number;
	terms?: string | null;
	notes?: string | null;
	internal_notes?: string | null;
	lines: ApiQuoteLineInput[];
}

export type ApiQuoteUpdateBody = Partial<Omit<ApiQuoteCreateBody, 'lines' | 'title' | 'currency'>> & {
	title?: string;
	currency?: string;
	lines?: ApiQuoteLineInput[];
};

export interface ApiQuoteListParams {
	limit?: number;
	cursor?: string;
	/** This release only supports draft listing when set. */
	status?: 'draft';
}

export interface ApiTaxRateListParams {
	limit?: number;
}
