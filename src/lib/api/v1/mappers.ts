import type { ClientFormData, ClientResource } from '$lib/schemas/client.js';
import type { ContactFormData, ContactListItem } from '$lib/schemas/contact.js';
import type { ConvertLeadFormData, LeadFormData, LeadResource } from '$lib/schemas/lead.js';
import { leadWritableStages } from '$lib/schemas/lead.js';
import type { AiIntegrationResource } from '$lib/schemas/integration.js';
import type { MailboxAccountResource, MailboxFormData } from '$lib/schemas/mailbox.js';
import { amountStringToCents, centsToAmountString } from '$lib/money.js';
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
	InvoiceFormData,
	InvoiceListItem
} from '$lib/schemas/invoice.js';
import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
import type { ProductFormData } from '$lib/schemas/product.js';
import type { QuoteFormData, QuoteListItem } from '$lib/schemas/quote.js';
import type { ClientRow } from '$lib/components/crm/clients-columns.js';
import type { LeadCard } from '$lib/components/crm/leads-board.svelte';
import type { ProductRow } from '$lib/components/crm/products-columns.js';
import type {
	ApiAiIntegration,
	ApiClient,
	ApiClientCreateBody,
	ApiClientUpdateBody,
	ApiContact,
	ApiContactCreateBody,
	ApiContactUpdateBody,
	ApiInvoice,
	ApiInvoiceCreateBody,
	ApiInvoiceDocument,
	ApiInvoiceLineInput,
	ApiInvoiceUpdateBody,
	ApiLead,
	ApiLeadConvertBody,
	ApiLeadCreateBody,
	ApiLeadUpdateBody,
	ApiMailboxAccount,
	ApiMailboxPutBody,
	ApiOrganisationConfiguration,
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrganisationMembership,
	ApiProduct,
	ApiProductCreateBody,
	ApiProductUpdateBody,
	ApiProfilePreferences,
	ApiQuote,
	ApiQuoteCreateBody,
	ApiQuoteDocument,
	ApiQuoteLineInput,
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

export function toContactFormData(
	contact: ApiContact,
	clientId: string | null = null
): ContactFormData {
	return {
		name: contact.display_name,
		email: contact.primary_email ?? '',
		phone: contact.primary_phone ?? '',
		company: contact.company_name ?? '',
		title: contact.job_title ?? '',
		status: contact.lifecycle_status,
		clientId: clientId ?? ''
	};
}

export function toContactCreateBody(data: ContactFormData): ApiContactCreateBody {
	return {
		display_name: data.name.trim(),
		primary_email: emptyToNull(data.email),
		primary_phone: emptyToNull(data.phone),
		company_name: emptyToNull(data.company),
		job_title: emptyToNull(data.title),
		lifecycle_status: data.status,
		client_id: emptyToNull(data.clientId)
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

export function productStatusLabel(status: ApiProduct['status']): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function toProductRow(product: ApiProduct): ProductRow {
	return {
		id: product.id,
		sku: product.sku,
		name: product.name,
		unitPrice: formatMoney(product.unit_price_cents, product.currency),
		stock: product.track_stock ? product.stock_qty : undefined,
		lowStockAt: product.low_stock_at ?? undefined,
		status: productStatusLabel(product.status)
	};
}

export function toCatalogProductOption(product: ApiProduct): CatalogProductOption {
	return {
		id: product.id,
		sku: product.sku,
		name: product.name,
		unitPrice: centsToAmountString(product.unit_price_cents) || '0'
	};
}

export function toProductFormData(product: ApiProduct): ProductFormData {
	return {
		sku: product.sku,
		name: product.name,
		description: product.description ?? '',
		unitPrice: centsToAmountString(product.unit_price_cents) || '0',
		trackStock: product.track_stock,
		stockQty: product.track_stock ? String(product.stock_qty) : '',
		status: product.status
	};
}

export function toProductCreateBody(data: ProductFormData): ApiProductCreateBody {
	return {
		sku: data.sku.trim(),
		name: data.name.trim(),
		description: data.description?.trim() || null,
		product_type: 'product',
		unit_price_cents: amountStringToCents(data.unitPrice) ?? 0,
		currency: 'GBP',
		track_stock: data.trackStock,
		status: data.status
	};
}

export function toProductUpdateBody(data: ProductFormData): ApiProductUpdateBody {
	return {
		sku: data.sku.trim(),
		name: data.name.trim(),
		description: data.description?.trim() || null,
		unit_price_cents: amountStringToCents(data.unitPrice) ?? 0,
		track_stock: data.trackStock,
		status: data.status
	};
}

export function toQuoteLineInput(data: LineItemFormData, position?: number): ApiQuoteLineInput {
	const quantity = Number(data.qty);
	const unitPriceCents = amountStringToCents(data.unitPrice) ?? 0;
	const productId = data.productId?.trim();
	if (productId) {
		return {
			product_id: productId,
			quantity,
			description: data.description.trim(),
			unit_price_cents: unitPriceCents,
			...(position === undefined ? {} : { position })
		};
	}
	return {
		product_id: null,
		description: data.description.trim(),
		quantity,
		unit_price_cents: unitPriceCents,
		...(position === undefined ? {} : { position })
	};
}

/** Preserve product link + discount/tax when rebuilding quote PATCH line payloads. */
export function lineItemRowsToQuoteLineInputs(
	lines: {
		productId?: string | null;
		description: string;
		qty: string;
		unitPrice: string;
		discountPercent?: number;
		taxRatePercent?: number;
	}[]
): ApiQuoteLineInput[] {
	return lines.map((line, index) => {
		const quantity = Number(line.qty);
		const unitPriceCents = amountStringToCents(line.unitPrice) ?? 0;
		const productId = line.productId?.trim() ? line.productId.trim() : null;
		const input: ApiQuoteLineInput = productId
			? {
					product_id: productId,
					quantity,
					description: line.description,
					unit_price_cents: unitPriceCents,
					position: index
				}
			: {
					product_id: null,
					description: line.description,
					quantity,
					unit_price_cents: unitPriceCents,
					position: index
				};
		if (line.discountPercent !== undefined) {
			input.discount_percent = line.discountPercent;
		}
		if (line.taxRatePercent !== undefined) {
			input.tax_rate_percent = line.taxRatePercent;
		}
		return input;
	});
}

export function invoiceStatusLabel(status: ApiInvoice['status']): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function toInvoiceListItem(invoice: ApiInvoice): InvoiceListItem {
	return {
		id: invoice.id,
		number: invoice.number,
		client: partyNameFromSnapshot(invoice.party_snapshot),
		total: formatMoney(invoice.total_cents, invoice.currency),
		status: invoiceStatusLabel(invoice.status),
		dueOn: invoice.due_on
	};
}

export function toInvoiceFormData(
	invoice: ApiInvoice | ApiInvoiceDocument,
	clientNameFallback = ''
): InvoiceFormData {
	const currency =
		invoice.currency === 'USD' || invoice.currency === 'EUR' || invoice.currency === 'GBP'
			? invoice.currency
			: 'GBP';
	const status =
		invoice.status === 'sent' ||
		invoice.status === 'partial' ||
		invoice.status === 'paid' ||
		invoice.status === 'void' ||
		invoice.status === 'draft'
			? invoice.status
			: 'draft';
	return {
		clientId: invoice.client_id,
		clientName: partyNameFromSnapshot(invoice.party_snapshot) || clientNameFallback,
		contactId: invoice.contact_id ?? '',
		currency,
		issueOn: invoice.issue_on,
		dueOn: invoice.due_on,
		purchaseOrderNumber: invoice.purchase_order_number ?? '',
		status,
		quoteId: invoice.quote_id ?? ''
	};
}

function optionalContactId(value: string | undefined): string | null | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function toInvoiceCreateBody(data: InvoiceFormData): ApiInvoiceCreateBody {
	return {
		client_id: data.clientId,
		contact_id: optionalContactId(data.contactId) ?? null,
		currency: data.currency,
		issue_on: data.issueOn,
		due_on: data.dueOn,
		purchase_order_number: data.purchaseOrderNumber?.trim() || null,
		lines: []
	};
}

export function toInvoiceUpdateBody(data: InvoiceFormData): ApiInvoiceUpdateBody {
	return {
		client_id: data.clientId,
		contact_id: optionalContactId(data.contactId) ?? null,
		currency: data.currency,
		issue_on: data.issueOn,
		due_on: data.dueOn,
		purchase_order_number: data.purchaseOrderNumber?.trim() || null
	};
}

export function toInvoiceLineInput(data: LineItemFormData, position?: number): ApiInvoiceLineInput {
	const quantity = Number(data.qty);
	const unitPriceCents = amountStringToCents(data.unitPrice) ?? 0;
	const productId = data.productId?.trim();
	if (productId) {
		return {
			product_id: productId,
			quantity,
			description: data.description.trim(),
			unit_price_cents: unitPriceCents,
			...(position === undefined ? {} : { position })
		};
	}
	return {
		product_id: null,
		description: data.description.trim(),
		quantity,
		unit_price_cents: unitPriceCents,
		...(position === undefined ? {} : { position })
	};
}

/** Preserve product link + discount/tax when rebuilding PATCH line payloads. */
export function lineItemRowsToInvoiceLineInputs(
	lines: {
		productId?: string | null;
		productSku?: string;
		description: string;
		qty: string;
		unitPrice: string;
		discountPercent?: number;
		taxRatePercent?: number;
	}[]
): ApiInvoiceLineInput[] {
	return lines.map((line, index) => {
		const quantity = Number(line.qty);
		const unitPriceCents = amountStringToCents(line.unitPrice) ?? 0;
		const productId = line.productId?.trim() ? line.productId.trim() : null;
		const input: ApiInvoiceLineInput = productId
			? {
					product_id: productId,
					quantity,
					description: line.description,
					unit_price_cents: unitPriceCents,
					position: index
				}
			: {
					product_id: null,
					description: line.description,
					quantity,
					unit_price_cents: unitPriceCents,
					position: index
				};
		if (line.discountPercent !== undefined) {
			input.discount_percent = line.discountPercent;
		}
		if (line.taxRatePercent !== undefined) {
			input.tax_rate_percent = line.taxRatePercent;
		}
		return input;
	});
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
		version: lead.version,
		position: lead.position,
		clientId: lead.client_id
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
		clientId: lead.client_id ?? '',
		stage,
		valueAmount: centsToAmountString(lead.value_cents),
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
	let valueCents: number | null = null;
	if (data.valueAmount !== undefined && data.valueAmount !== '') {
		valueCents = amountStringToCents(data.valueAmount);
	}
	const probability =
		data.probabilityPercent === undefined || data.probabilityPercent === ''
			? null
			: Number(data.probabilityPercent);
	return {
		name: data.name.trim(),
		company_name: emptyToNull(data.companyName),
		client_id: emptyToNull(data.clientId),
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

export function toMailboxAccountResource(
	account: ApiMailboxAccount | null | undefined
): MailboxAccountResource | null {
	if (!account) return null;
	return {
		id: account.id,
		email_address: account.email_address,
		username: account.username,
		from_name: account.from_name,
		imap_host: account.imap_host,
		imap_port: account.imap_port,
		imap_security: account.imap_security,
		smtp_host: account.smtp_host,
		smtp_port: account.smtp_port,
		smtp_security: account.smtp_security,
		credentials_configured: account.credentials_configured,
		status: account.status,
		last_checked_at: account.last_checked_at,
		last_error_code: account.last_error_code
	};
}

export function toMailboxPutBody(data: MailboxFormData): ApiMailboxPutBody {
	const body: ApiMailboxPutBody = {
		email_address: data.emailAddress.trim(),
		username: (data.username.trim() || data.emailAddress.trim()),
		from_name: emptyToNull(data.fromName),
		imap_host: data.imapHost.trim(),
		imap_port: Number(data.imapPort),
		imap_security: data.imapSecurity,
		smtp_host: data.smtpHost.trim(),
		smtp_port: Number(data.smtpPort),
		smtp_security: data.smtpSecurity
	};
	const password = data.password.trim();
	if (password) body.password = password;
	return body;
}

export function toAiIntegrationResource(item: ApiAiIntegration): AiIntegrationResource {
	return {
		provider: item.provider,
		credentials_configured: item.credentials_configured,
		status: item.status,
		last_verified_at: item.last_verified_at,
		last_error_code: item.last_error_code
	};
}
