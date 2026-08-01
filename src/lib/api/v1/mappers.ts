import type { ClientFormData, ClientResource } from '$lib/schemas/client.js';
import type { ContactFormData, ContactListItem } from '$lib/schemas/contact.js';
import type { ConvertLeadFormData, LeadFormData, LeadResource } from '$lib/schemas/lead.js';
import { leadWritableStages } from '$lib/schemas/lead.js';
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
import type { QuoteFormData, QuoteListItem } from '$lib/schemas/quote.js';
import type { ClientRow } from '$lib/components/crm/clients-columns.js';
import type { LeadCard } from '$lib/components/crm/leads-board.svelte';
import type {
	ApiClient,
	ApiClientCreateBody,
	ApiClientUpdateBody,
	ApiContact,
	ApiContactCreateBody,
	ApiContactUpdateBody,
	ApiLead,
	ApiLeadConvertBody,
	ApiLeadCreateBody,
	ApiLeadUpdateBody,
	ApiOrganisationConfiguration,
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrganisationMembership,
	ApiProfilePreferences,
	ApiQuote,
	ApiQuoteCreateBody,
	ApiQuoteDocument,
	ApiQuoteUpdateBody,
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
		role: row.membership.role,
		theme_default: row.organisation.theme_default ?? 'system'
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
		role: result.membership.role,
		theme_default: result.organisation.theme_default ?? 'system'
	};
}

export function toOrganisationCreateBody(
	data: OrganisationCreateData
): ApiOrganisationCreateBody {
	return {
		name: data.name.trim(),
		slug: data.slug.trim(),
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
		name: data.name.trim(),
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

function emptyToNull(value: string | undefined): string | null {
	if (value === undefined) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function contactLifecycleLabel(status: ApiContact['lifecycle_status']): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function toContactListItem(contact: ApiContact): ContactListItem {
	return {
		id: contact.id,
		name: contact.display_name,
		email: contact.primary_email ?? '',
		company: contact.company_name ?? undefined,
		status: contactLifecycleLabel(contact.lifecycle_status),
		owner: undefined
	};
}

export function toContactFormData(contact: ApiContact): ContactFormData {
	return {
		name: contact.display_name,
		email: contact.primary_email ?? '',
		phone: contact.primary_phone ?? '',
		company: contact.company_name ?? '',
		title: contact.job_title ?? '',
		status: contact.lifecycle_status
	};
}

export function toContactCreateBody(data: ContactFormData): ApiContactCreateBody {
	return {
		display_name: data.name.trim(),
		primary_email: emptyToNull(data.email),
		primary_phone: emptyToNull(data.phone),
		company_name: emptyToNull(data.company),
		job_title: emptyToNull(data.title),
		lifecycle_status: data.status
	};
}

export function toContactUpdateBody(data: ContactFormData): ApiContactUpdateBody {
	return toContactCreateBody(data);
}

function partyNameFromSnapshot(snapshot: unknown): string {
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '—';
	const record = snapshot as Record<string, unknown>;
	for (const key of ['name', 'display_name', 'client_name', 'company_name'] as const) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	const nested = record.client ?? record.party;
	if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
		const nestedRecord = nested as Record<string, unknown>;
		const name = nestedRecord.name ?? nestedRecord.display_name;
		if (typeof name === 'string' && name.trim()) return name.trim();
	}
	return '—';
}

function formatMoney(cents: number, currency: string): string {
	try {
		return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency}`;
	}
}

export function quoteStatusLabel(status: ApiQuote['status']): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function toQuoteListItem(quote: ApiQuote): QuoteListItem {
	return {
		id: quote.id,
		number: quote.number,
		client: partyNameFromSnapshot(quote.party_snapshot),
		total: formatMoney(quote.total_cents, quote.currency),
		status: quoteStatusLabel(quote.status),
		validUntil: quote.valid_until ?? '—'
	};
}

export function toQuoteFormData(
	quote: ApiQuote | ApiQuoteDocument,
	clientNameFallback = ''
): QuoteFormData {
	const currency =
		quote.currency === 'USD' || quote.currency === 'EUR' || quote.currency === 'GBP'
			? quote.currency
			: 'GBP';
	const status =
		quote.status === 'sent' ||
		quote.status === 'accepted' ||
		quote.status === 'rejected' ||
		quote.status === 'expired' ||
		quote.status === 'void' ||
		quote.status === 'draft'
			? quote.status
			: 'draft';
	return {
		clientId: quote.client_id ?? '00000000-0000-4000-8000-000000000000',
		clientName: partyNameFromSnapshot(quote.party_snapshot) || clientNameFallback,
		title: quote.title,
		currency,
		status
	};
}

export function toQuoteCreateBody(data: QuoteFormData): ApiQuoteCreateBody {
	return {
		title: data.title.trim(),
		client_id: data.clientId,
		currency: data.currency,
		lines: []
	};
}

export function toQuoteUpdateBody(data: QuoteFormData): ApiQuoteUpdateBody {
	return {
		title: data.title.trim(),
		client_id: data.clientId,
		currency: data.currency
	};
}

export function clientStatusLabel(status: ApiClient['status']): string {
	return status
		.split('_')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function toClientRow(client: ApiClient): ClientRow {
	return {
		id: client.id,
		name: client.name,
		status: clientStatusLabel(client.status),
		owner: undefined,
		openInvoices: '—',
		pipeline: '—'
	};
}

export function toClientResource(client: ApiClient): ClientResource {
	return {
		id: client.id,
		version: client.version,
		name: client.name,
		status: client.status,
		website_url: client.website_url,
		industry: client.industry,
		primary_email: client.primary_email,
		phone: client.phone,
		tax_identifier: client.tax_identifier,
		registration_number: client.registration_number,
		default_currency: client.default_currency,
		payment_terms_days: client.payment_terms_days,
		renewal_on: client.renewal_on,
		notes: client.notes,
		converted_from_lead_id: client.converted_from_lead_id,
		owner_label: null
	};
}

export function toClientFormData(client: ApiClient): ClientFormData {
	return {
		name: client.name,
		status: client.status,
		websiteUrl: client.website_url ?? '',
		industry: client.industry ?? '',
		primaryEmail: client.primary_email ?? '',
		phone: client.phone ?? '',
		taxIdentifier: client.tax_identifier ?? '',
		registrationNumber: client.registration_number ?? '',
		defaultCurrency: client.default_currency ?? '',
		paymentTermsDays:
			client.payment_terms_days == null ? '' : String(client.payment_terms_days),
		renewalOn: client.renewal_on ?? '',
		notes: client.notes ?? ''
	};
}

export function toClientCreateBody(data: ClientFormData): ApiClientCreateBody {
	const paymentTerms =
		data.paymentTermsDays === undefined || data.paymentTermsDays === ''
			? null
			: Number(data.paymentTermsDays);
	return {
		name: data.name.trim(),
		status: data.status,
		website_url: emptyToNull(data.websiteUrl),
		industry: emptyToNull(data.industry),
		primary_email: emptyToNull(data.primaryEmail),
		phone: emptyToNull(data.phone),
		tax_identifier: emptyToNull(data.taxIdentifier),
		registration_number: emptyToNull(data.registrationNumber),
		default_currency: emptyToNull(data.defaultCurrency),
		payment_terms_days: paymentTerms,
		renewal_on: emptyToNull(data.renewalOn),
		notes: emptyToNull(data.notes)
	};
}

export function toClientUpdateBody(data: ClientFormData): ApiClientUpdateBody {
	return toClientCreateBody(data);
}

export function leadStageLabel(stage: ApiLead['stage']): string {
	return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function toLeadCard(lead: ApiLead): LeadCard {
	return {
		id: lead.id,
		name: lead.name,
		companyName: lead.company_name,
		valueCents: lead.value_cents,
		currency: lead.currency,
		owner: null,
		stage: lead.stage,
		version: lead.version
	};
}

export function toLeadResource(lead: ApiLead): LeadResource {
	return {
		id: lead.id,
		version: lead.version,
		name: lead.name,
		company_name: lead.company_name,
		stage: lead.stage,
		value_cents: lead.value_cents,
		currency: lead.currency,
		probability_percent: lead.probability_percent,
		source: lead.source,
		expected_close_on: lead.expected_close_on,
		lost_reason: lead.lost_reason,
		lost_at: lead.lost_at,
		won_at: lead.won_at,
		converted_at: lead.converted_at,
		client_id: lead.client_id,
		notes: lead.notes,
		owner_label: null
	};
}

export function toLeadFormData(lead: ApiLead): LeadFormData {
	const stage = (leadWritableStages as readonly string[]).includes(lead.stage)
		? (lead.stage as (typeof leadWritableStages)[number])
		: 'new';
	return {
		name: lead.name,
		companyName: lead.company_name ?? '',
		stage,
		valueCents: lead.value_cents == null ? '' : String(lead.value_cents),
		currency: lead.currency,
		probabilityPercent:
			lead.probability_percent == null ? '' : String(lead.probability_percent),
		source: lead.source ?? '',
		expectedCloseOn: lead.expected_close_on ?? '',
		lostReason: lead.lost_reason ?? '',
		notes: lead.notes ?? ''
	};
}

export function toLeadCreateBody(data: LeadFormData): ApiLeadCreateBody {
	const valueCents =
		data.valueCents === undefined || data.valueCents === '' ? null : Number(data.valueCents);
	const probability =
		data.probabilityPercent === undefined || data.probabilityPercent === ''
			? null
			: Number(data.probabilityPercent);
	return {
		name: data.name.trim(),
		company_name: emptyToNull(data.companyName),
		stage: data.stage,
		value_cents: valueCents,
		currency: data.currency,
		probability_percent: probability,
		source: emptyToNull(data.source),
		expected_close_on: emptyToNull(data.expectedCloseOn),
		lost_reason: emptyToNull(data.lostReason),
		notes: emptyToNull(data.notes)
	};
}

export function toLeadUpdateBody(data: LeadFormData): ApiLeadUpdateBody {
	return toLeadCreateBody(data);
}

export function toLeadConvertBody(data: ConvertLeadFormData): ApiLeadConvertBody {
	const body: ApiLeadConvertBody = {
		client_status: data.clientStatus
	};
	const name = emptyToNull(data.clientName);
	if (name) body.client_name = name;
	return body;
}
