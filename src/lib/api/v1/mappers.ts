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
import type {
	RecurringInvoiceFormData,
	RecurringInvoiceListItem,
	RecurringInvoiceRunListItem,
	RecurringLineFormData
} from '$lib/schemas/recurring-invoice.js';
import type { BillFormData, BillListItem } from '$lib/schemas/bill.js';
import type {
	PaymentAllocationRow,
	PaymentFormData,
	PaymentListItem
} from '$lib/schemas/payment.js';
import type { VendorFormData } from '$lib/schemas/vendor.js';
import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
import type { ProductFormData } from '$lib/schemas/product.js';
import type { QuoteFormData, QuoteListItem } from '$lib/schemas/quote.js';
import type {
	TaskAssigneeOption,
	TaskBoardStatus,
	TaskFormData,
	TaskListItem
} from '$lib/schemas/task.js';
import type { TaskRow } from '$lib/components/crm/tasks-columns.js';
import type { EmailMessage } from '$lib/components/crm/entity-email-inbox.svelte';
import type { ClientRow } from '$lib/components/crm/clients-columns.js';
import type { EmailTemplateRow } from '$lib/components/crm/email-templates-columns.js';
import type { LeadCard } from '$lib/components/crm/leads-board.svelte';
import type { ProductRow } from '$lib/components/crm/products-columns.js';
import type { EmailTemplateFormData } from '$lib/schemas/email-template.js';
import type {
	ApiAiIntegration,
	ApiEmailMessage,
	ApiEmailTemplate,
	ApiEmailTemplateCreateBody,
	ApiEmailTemplateUpdateBody,
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
	ApiBill,
	ApiBillCreateBody,
	ApiBillDocument,
	ApiBillLineInput,
	ApiBillUpdateBody,
	ApiVendor,
	ApiVendorCreateBody,
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
	ApiPayment,
	ApiPaymentAllocation,
	ApiPaymentCreateBody,
	ApiPaymentDocument,
	ApiRecurringInvoiceCreateBody,
	ApiRecurringInvoiceDocument,
	ApiRecurringInvoiceLineInput,
	ApiRecurringInvoiceRun,
	ApiRecurringInvoiceSchedule,
	ApiRecurringInvoiceUpdateBody,
	ApiTaxRate,
	ApiTaxRateCreateBody,
	ApiTask,
	ApiTaskCreateBody,
	ApiTaskUpdateBody
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
		membership_id: row.membership.id,
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
		membership_id: result.membership.id,
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

export function billStatusLabel(status: ApiBill['status']): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function toBillListItem(bill: ApiBill): BillListItem {
	return {
		id: bill.id,
		number: bill.number,
		vendor: partyNameFromSnapshot(bill.party_snapshot),
		total: formatMoney(bill.total_cents, bill.currency),
		status: billStatusLabel(bill.status),
		dueOn: bill.due_on
	};
}

export function toBillFormData(
	bill: ApiBill | ApiBillDocument,
	vendorNameFallback = ''
): BillFormData {
	const currency =
		bill.currency === 'USD' || bill.currency === 'EUR' || bill.currency === 'GBP'
			? bill.currency
			: 'GBP';
	const status =
		bill.status === 'received' ||
		bill.status === 'scheduled' ||
		bill.status === 'partial' ||
		bill.status === 'paid' ||
		bill.status === 'void' ||
		bill.status === 'draft'
			? bill.status
			: 'draft';
	return {
		vendorId: bill.vendor_id,
		vendorName: partyNameFromSnapshot(bill.party_snapshot) || vendorNameFallback,
		number: bill.number,
		internalReference: bill.internal_reference ?? '',
		currency,
		issueOn: bill.issue_on ?? '',
		receivedOn: bill.received_on ?? '',
		dueOn: bill.due_on,
		notes: bill.notes ?? '',
		status
	};
}

export function toBillCreateBody(data: BillFormData): ApiBillCreateBody {
	return {
		vendor_id: data.vendorId,
		number: data.number.trim(),
		internal_reference: data.internalReference?.trim() || null,
		currency: data.currency,
		issue_on: data.issueOn?.trim() || null,
		received_on: data.receivedOn?.trim() || null,
		due_on: data.dueOn,
		notes: data.notes?.trim() || null,
		lines: []
	};
}

export function toBillUpdateBody(data: BillFormData): ApiBillUpdateBody {
	return {
		vendor_id: data.vendorId,
		number: data.number.trim(),
		internal_reference: data.internalReference?.trim() || null,
		currency: data.currency,
		issue_on: data.issueOn?.trim() || null,
		received_on: data.receivedOn?.trim() || null,
		due_on: data.dueOn,
		notes: data.notes?.trim() || null
	};
}

export function toBillLineInput(data: LineItemFormData, position?: number): ApiBillLineInput {
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

export function lineItemRowsToBillLineInputs(
	lines: {
		productId?: string | null;
		productSku?: string;
		description: string;
		qty: string;
		unitPrice: string;
		discountPercent?: number;
		taxRatePercent?: number;
	}[]
): ApiBillLineInput[] {
	return lines.map((line, index) => {
		const quantity = Number(line.qty);
		const unitPriceCents = amountStringToCents(line.unitPrice) ?? 0;
		const productId = line.productId?.trim() ? line.productId.trim() : null;
		const input: ApiBillLineInput = productId
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

export function toVendorCreateBody(data: VendorFormData): ApiVendorCreateBody {
	return {
		name: data.name.trim()
	};
}

export function toVendorFormData(vendor: ApiVendor): VendorFormData {
	return {
		name: vendor.name
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

function mapAiIntegrationStatus(status: string | null | undefined): AiIntegrationResource['status'] {
	if (status === 'active' || status === 'connected') return 'connected';
	if (status === 'error') return 'error';
	return 'disconnected';
}

export function toAiIntegrationResource(item: ApiAiIntegration): AiIntegrationResource {
	return {
		provider: item.provider,
		credentials_configured: item.credentials_configured,
		status: mapAiIntegrationStatus(item.status),
		last_verified_at: item.last_verified_at ?? null,
		last_error_code: item.last_error_code
	};
}

/** Prefer BE `output_text`; fall back to legacy `suggestion_text`. */
export function aiSuggestionText(suggestion: {
	output_text?: string | null;
	suggestion_text?: string | null;
}): string {
	return suggestion.output_text ?? suggestion.suggestion_text ?? '';
}


function firstAddress(value: unknown): string {
	if (Array.isArray(value) && value.length > 0) {
		const first = value[0];
		if (typeof first === 'string') return first;
		if (first && typeof first === 'object' && 'address' in first) {
			const addr = (first as { address?: unknown }).address;
			if (typeof addr === 'string') return addr;
		}
	}
	if (typeof value === 'string') return value;
	return '';
}

const TASK_PRIORITY_LABELS: Record<string, string> = {
	p1: 'P1 — Urgent',
	p2: 'P2 — High',
	p3: 'P3 — Normal',
	p4: 'P4 — Low'
};

const TASK_STATUS_LABELS: Record<string, string> = {
	open: 'Open',
	in_progress: 'In progress',
	blocked: 'Blocked',
	done: 'Done',
	cancelled: 'Cancelled'
};

export function taskPriorityLabel(priority: string): string {
	return TASK_PRIORITY_LABELS[priority] ?? priority;
}

export function taskStatusLabel(status: string): string {
	return TASK_STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

function formatTaskDue(dueAt: string | null): string {
	if (!dueAt) return '—';
	const date = dueAt.slice(0, 10);
	return date || '—';
}

function dueOnToApi(dueOn: string | undefined): string | null {
	const trimmed = dueOn?.trim();
	if (!trimmed) return null;
	return `${trimmed}T00:00:00.000Z`;
}

function dueAtToForm(dueAt: string | null): string {
	if (!dueAt) return '';
	return dueAt.slice(0, 10);
}

export function assigneeLabel(
	assigneeMembershipId: string | null,
	options: {
		currentMembershipId?: string | null;
		assigneeOptions?: TaskAssigneeOption[];
	}
): string {
	if (!assigneeMembershipId) return 'Unassigned';
	if (options.currentMembershipId && assigneeMembershipId === options.currentMembershipId) {
		return 'Me';
	}
	const match = options.assigneeOptions?.find((o) => o.id === assigneeMembershipId);
	return match?.label ?? 'Teammate';
}

export function assigneeOptionsFromMemberships(
	membershipRows: ApiOrganisationMembership[],
	selectedOrgId: string | null
): TaskAssigneeOption[] {
	if (!selectedOrgId) return [];
	const row = membershipRows.find((entry) => entry.organisation.id === selectedOrgId);
	if (!row) return [];
	return [{ id: row.membership.id, label: 'Me' }];
}

export function toTaskListItem(
	task: ApiTask,
	options: {
		currentMembershipId?: string | null;
		assigneeOptions?: TaskAssigneeOption[];
	} = {}
): TaskListItem {
	return {
		id: task.id,
		title: task.title,
		relatedTo: task.entity_type ? task.entity_type : '—',
		owner: assigneeLabel(task.assignee_membership_id, options),
		status: taskStatusLabel(task.status),
		priority: taskPriorityLabel(task.priority),
		dueOn: formatTaskDue(task.due_at),
		version: task.version,
		assigneeMembershipId: task.assignee_membership_id,
		rawStatus: task.status,
		rawPriority: task.priority,
		description: task.description ?? '',
		dueAt: task.due_at,
		position: task.position
	};
}

export function toTaskRow(item: TaskListItem): TaskRow {
	return {
		id: item.id,
		title: item.title,
		relatedTo: item.relatedTo,
		owner: item.owner,
		status: item.status,
		priority: item.priority,
		dueOn: item.dueOn
	};
}

export function toTaskBoardCard(item: TaskListItem): {
	id: string;
	title: string;
	relatedTo?: string;
	owner?: string;
	status: TaskBoardStatus;
	dueOn?: string;
} {
	const status: TaskBoardStatus =
		item.rawStatus === 'cancelled' ? 'done' : (item.rawStatus as TaskBoardStatus);
	return {
		id: item.id,
		title: item.title,
		relatedTo: item.relatedTo === '—' ? undefined : item.relatedTo,
		owner: item.owner === 'Unassigned' ? undefined : item.owner,
		status,
		dueOn: item.dueOn === '—' ? undefined : item.dueOn
	};
}

export function toTaskFormData(task: ApiTask | TaskListItem): TaskFormData {
	if ('rawStatus' in task) {
		return {
			title: task.title,
			description: task.description,
			priority: task.rawPriority,
			status: task.rawStatus,
			assigneeMembershipId: task.assigneeMembershipId ?? '',
			dueOn: dueAtToForm(task.dueAt)
		};
	}
	return {
		title: task.title,
		description: task.description ?? '',
		priority: task.priority,
		status: task.status,
		assigneeMembershipId: task.assignee_membership_id ?? '',
		dueOn: dueAtToForm(task.due_at)
	};
}

export function emptyTaskFormData(): TaskFormData {
	return {
		title: '',
		description: '',
		priority: 'p3',
		status: 'open',
		assigneeMembershipId: '',
		dueOn: ''
	};
}

export function toTaskCreateBody(data: TaskFormData): ApiTaskCreateBody {
	return {
		title: data.title.trim(),
		description: data.description?.trim() ? data.description.trim() : null,
		priority: data.priority,
		status: data.status,
		assignee_membership_id: data.assigneeMembershipId?.trim()
			? data.assigneeMembershipId.trim()
			: null,
		due_at: dueOnToApi(data.dueOn),
		source: 'manual'
	};
}

export function toTaskUpdateBody(data: TaskFormData): ApiTaskUpdateBody {
	return toTaskCreateBody(data);
}

export function toEntityEmailMessage(row: ApiEmailMessage): EmailMessage {
	const occurred = row.direction === 'outbound' ? row.sent_at : row.received_at;
	return {
		id: row.id,
		direction: row.direction === 'outbound' ? 'out' : 'in',
		from: row.from_name?.trim() || row.from_address,
		to: firstAddress(row.to_addresses),
		subject: row.subject || '(no subject)',
		preview: row.preview_text || row.body_text?.slice(0, 160) || '',
		body: row.body_text || '',
		occurredAt: occurred ? new Date(occurred).toLocaleString() : '',
		unread: row.unread
	};
}

function formatEmailTemplateUpdatedAt(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

export function toEmailTemplateRow(template: ApiEmailTemplate): EmailTemplateRow {
	return {
		id: template.id,
		name: template.name,
		subject: template.subject,
		category: template.category,
		status: template.status,
		updatedAt: formatEmailTemplateUpdatedAt(template.updated_at),
		version: template.version
	};
}

export function toEmailTemplateFormData(template: ApiEmailTemplate): EmailTemplateFormData {
	return {
		name: template.name,
		subject: template.subject,
		body: template.body_text || template.body_html || '',
		category: template.category,
		status: template.status
	};
}

export function toEmailTemplateCreateBody(data: EmailTemplateFormData): ApiEmailTemplateCreateBody {
	return {
		name: data.name.trim(),
		subject: data.subject.trim(),
		body_text: data.body,
		body_html: null,
		category: data.category,
		status: data.status
	};
}

export function toEmailTemplateUpdateBody(data: EmailTemplateFormData): ApiEmailTemplateUpdateBody {
	return toEmailTemplateCreateBody(data);
}

export function recurringInvoiceStatusLabel(
	status: ApiRecurringInvoiceSchedule['status']
): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function recurringInvoiceFrequencyLabel(
	frequency: ApiRecurringInvoiceSchedule['frequency'],
	intervalCount: number
): string {
	const base =
		frequency === 'daily'
			? 'Daily'
			: frequency === 'weekly'
				? 'Weekly'
				: frequency === 'monthly'
					? 'Monthly'
					: 'Yearly';
	if (intervalCount <= 1) return base;
	return `Every ${intervalCount} ${frequency === 'daily' ? 'days' : frequency === 'weekly' ? 'weeks' : frequency === 'monthly' ? 'months' : 'years'}`;
}

function formatNextRunAt(value: string | null | undefined): string {
	if (!value) return '—';
	try {
		return new Date(value).toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	} catch {
		return value;
	}
}

export function toRecurringInvoiceListItem(
	schedule: ApiRecurringInvoiceSchedule,
	clientNameFallback = ''
): RecurringInvoiceListItem {
	return {
		id: schedule.id,
		name: schedule.name,
		client: (schedule.client_name ?? clientNameFallback) || '—',
		status: recurringInvoiceStatusLabel(schedule.status),
		frequency: recurringInvoiceFrequencyLabel(schedule.frequency, schedule.interval_count),
		nextRunAt: formatNextRunAt(schedule.next_run_at),
		deliveryMode: schedule.delivery_mode === 'auto_send' ? 'Auto-send' : 'Draft',
		version: schedule.version
	};
}

export function emptyRecurringInvoiceFormData(): RecurringInvoiceFormData {
	const today = new Date().toISOString().slice(0, 10);
	return {
		name: '',
		clientId: '00000000-0000-4000-8000-000000000000',
		clientName: '',
		contactId: '',
		currency: 'GBP',
		frequency: 'monthly',
		intervalCount: 1,
		anchorOn: today,
		weekday: '1',
		dayOfMonth: 1,
		monthOfYear: 1,
		monthEndPolicy: 'clamp',
		timezone: 'Europe/London',
		localRunTime: '09:00',
		startOn: today,
		endOn: '',
		maxOccurrences: '',
		dueDays: 14,
		deliveryMode: 'draft',
		pricingMode: 'fixed',
		catchUpPolicy: 'latest',
		maxCatchUpRuns: 1,
		purchaseOrderNumber: '',
		paymentTerms: '',
		notes: '',
		internalNotes: '',
		status: 'draft'
	};
}

export function toRecurringInvoiceFormData(
	document: ApiRecurringInvoiceSchedule | ApiRecurringInvoiceDocument,
	clientNameFallback = ''
): RecurringInvoiceFormData {
	const currency =
		document.currency === 'USD' || document.currency === 'EUR' || document.currency === 'GBP'
			? document.currency
			: 'GBP';
	return {
		name: document.name,
		clientId: document.client_id,
		clientName: document.client_name ?? clientNameFallback,
		contactId: document.contact_id ?? '',
		currency,
		frequency: document.frequency,
		intervalCount: document.interval_count,
		anchorOn: document.anchor_on,
		weekday: document.weekdays?.[0] != null ? String(document.weekdays[0]) : '1',
		dayOfMonth: document.day_of_month,
		monthOfYear: document.month_of_year,
		monthEndPolicy: document.month_end_policy,
		timezone: document.timezone,
		localRunTime: document.local_run_time.slice(0, 5),
		startOn: document.start_on,
		endOn: document.end_on ?? '',
		maxOccurrences:
			document.max_occurrences != null ? String(document.max_occurrences) : '',
		dueDays: document.due_days,
		deliveryMode: document.delivery_mode,
		pricingMode: document.pricing_mode,
		catchUpPolicy: document.catch_up_policy,
		maxCatchUpRuns: document.max_catch_up_runs,
		purchaseOrderNumber: document.purchase_order_number ?? '',
		paymentTerms: document.payment_terms ?? '',
		notes: document.notes ?? '',
		internalNotes: document.internal_notes ?? '',
		status: document.status
	};
}

function recurringFrequencyFields(data: RecurringInvoiceFormData): Pick<
	ApiRecurringInvoiceCreateBody,
	'weekdays' | 'day_of_month' | 'month_of_year'
> {
	if (data.frequency === 'weekly') {
		const day = Number(data.weekday) || 1;
		return { weekdays: [day], day_of_month: null, month_of_year: null };
	}
	if (data.frequency === 'monthly') {
		return {
			weekdays: null,
			day_of_month: data.dayOfMonth ?? 1,
			month_of_year: null
		};
	}
	if (data.frequency === 'yearly') {
		return {
			weekdays: null,
			day_of_month: data.dayOfMonth ?? 1,
			month_of_year: data.monthOfYear ?? 1
		};
	}
	return { weekdays: null, day_of_month: null, month_of_year: null };
}

function normalizeLocalRunTime(value: string): string {
	const trimmed = value.trim();
	if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
	return trimmed;
}

function recurringWritableFields(
	data: RecurringInvoiceFormData
): Omit<ApiRecurringInvoiceCreateBody, 'lines'> {
	const maxOcc = data.maxOccurrences?.trim();
	return {
		name: data.name.trim(),
		client_id: data.clientId,
		contact_id: data.contactId?.trim() ? data.contactId.trim() : null,
		currency: data.currency,
		frequency: data.frequency,
		interval_count: data.intervalCount,
		anchor_on: data.anchorOn,
		...recurringFrequencyFields(data),
		month_end_policy: data.monthEndPolicy,
		timezone: data.timezone.trim(),
		local_run_time: normalizeLocalRunTime(data.localRunTime),
		start_on: data.startOn,
		end_on: data.endOn?.trim() ? data.endOn.trim() : null,
		max_occurrences: maxOcc ? Number(maxOcc) : null,
		due_days: data.dueDays,
		delivery_mode: data.deliveryMode,
		pricing_mode: data.pricingMode,
		catch_up_policy: data.catchUpPolicy,
		max_catch_up_runs: data.maxCatchUpRuns,
		purchase_order_number: data.purchaseOrderNumber?.trim() || null,
		payment_terms: data.paymentTerms?.trim() || null,
		notes: data.notes?.trim() || null,
		internal_notes: data.internalNotes?.trim() || null
	};
}

export interface RecurringLineRow {
	id: string;
	productId?: string | null;
	productSku?: string;
	descriptionTemplate: string;
	qty: string;
	unitPrice: string;
	taxRatePercent: string;
}

export function toRecurringLineFormData(row: RecurringLineRow): RecurringLineFormData {
	return {
		productId: row.productId ?? '',
		descriptionTemplate: row.descriptionTemplate,
		qty: row.qty,
		unitPrice: row.unitPrice,
		taxRatePercent: row.taxRatePercent
	};
}

export function recurringLineRowsFromDocument(
	document: ApiRecurringInvoiceDocument
): RecurringLineRow[] {
	return document.lines.map((line) => ({
		id: line.id,
		productId: line.product_id,
		productSku: line.sku_snapshot ?? undefined,
		descriptionTemplate: line.description_template,
		qty: String(line.quantity),
		unitPrice: centsToAmountString(line.unit_price_cents) || '0',
		taxRatePercent: String(line.tax_rate_percent ?? 0)
	}));
}

export function toRecurringLineInput(
	data: RecurringLineFormData,
	position?: number
): ApiRecurringInvoiceLineInput {
	const unitCents = amountStringToCents(data.unitPrice);
	if (unitCents == null) throw new Error('Invalid unit price');
	const tax = data.taxRatePercent?.trim();
	const input: ApiRecurringInvoiceLineInput = {
		description_template: data.descriptionTemplate.trim(),
		quantity: data.qty,
		unit_price_cents: unitCents,
		discount_percent: '0',
		tax_rate_percent: tax ? tax : '0',
		position
	};
	const productId = data.productId?.trim();
	if (productId) input.product_id = productId;
	return input;
}

export function recurringLineRowsToInputs(rows: RecurringLineRow[]): ApiRecurringInvoiceLineInput[] {
	return rows.map((row, index) =>
		toRecurringLineInput(toRecurringLineFormData(row), index + 1)
	);
}

export function toRecurringInvoiceCreateBody(
	data: RecurringInvoiceFormData,
	lines: RecurringLineRow[]
): ApiRecurringInvoiceCreateBody {
	return {
		...recurringWritableFields(data),
		lines: recurringLineRowsToInputs(lines)
	};
}

export function toRecurringInvoiceUpdateBody(
	data: RecurringInvoiceFormData,
	lines: RecurringLineRow[]
): ApiRecurringInvoiceUpdateBody {
	return {
		...recurringWritableFields(data),
		lines: recurringLineRowsToInputs(lines)
	};
}

export function toRecurringInvoiceRunListItem(
	run: ApiRecurringInvoiceRun,
	invoiceByRunId?: Map<string, { id: string; number: string }>
): RecurringInvoiceRunListItem {
	const linked = invoiceByRunId?.get(run.id);
	return {
		id: run.id,
		scheduledFor: formatNextRunAt(run.scheduled_for),
		trigger: run.trigger.replace('_', ' '),
		status: run.status.replace(/_/g, ' '),
		periodStart: run.period_start,
		periodEnd: run.period_end,
		invoiceId: linked?.id ?? run.invoice_id ?? null,
		invoiceNumber: linked?.number ?? run.invoice_number ?? null
	};
}

export function paymentStatusLabel(status: ApiPayment['status']): string {
	return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function paymentMethodLabel(method: ApiPayment['method']): string {
	if (method === 'stripe') return 'Stripe';
	return method.charAt(0).toUpperCase() + method.slice(1);
}

export function paymentDirectionLabel(direction: ApiPayment['direction']): string {
	return direction === 'inbound' ? 'Inbound' : 'Outbound';
}

function allocationSummary(payment: ApiPayment | ApiPaymentDocument): string {
	const doc = 'allocations' in payment ? payment : null;
	const active = doc?.allocations?.filter((a) => !a.reversed_at) ?? [];
	if (active.length === 0) {
		if (payment.status === 'unallocated') return 'Unallocated';
		return '—';
	}
	if (active.length === 1) {
		const a = active[0]!;
		return a.invoice_number ?? a.bill_number ?? (a.invoice_id ? 'Invoice' : 'Bill');
	}
	return `${active.length} allocations`;
}

export function toPaymentListItem(
	payment: ApiPayment | ApiPaymentDocument,
	partyNames?: { clientName?: string; vendorName?: string }
): PaymentListItem {
	const party =
		payment.direction === 'inbound'
			? (partyNames?.clientName ?? '—')
			: (partyNames?.vendorName ?? '—');
	return {
		id: payment.id,
		direction: paymentDirectionLabel(payment.direction),
		party,
		amount: formatMoney(payment.amount_cents, payment.currency),
		method: paymentMethodLabel(payment.method),
		status: paymentStatusLabel(payment.status),
		occurredOn: payment.occurred_on,
		allocationsSummary: allocationSummary(payment),
		statusKey: payment.status,
		version: payment.version
	};
}

export function toPaymentAllocationRow(
	allocation: ApiPaymentAllocation,
	currency: string
): PaymentAllocationRow {
	const targetLabel =
		allocation.invoice_number ??
		allocation.bill_number ??
		(allocation.invoice_id ? 'Invoice' : allocation.bill_id ? 'Bill' : '—');
	return {
		id: allocation.id,
		paymentId: allocation.payment_id,
		targetLabel,
		amount: formatMoney(allocation.amount_cents, currency),
		allocatedAt: allocation.allocated_at.slice(0, 10),
		reversed: Boolean(allocation.reversed_at)
	};
}

export function toPaymentCreateBody(data: PaymentFormData): ApiPaymentCreateBody {
	const amountCents = amountStringToCents(data.amount);
	if (amountCents == null || amountCents <= 0) {
		throw new Error('Amount must be greater than zero');
	}

	const body: ApiPaymentCreateBody = {
		direction: data.direction,
		amount_cents: amountCents,
		currency: data.currency,
		method: data.method,
		occurred_on: data.occurredOn,
		provider: 'manual',
		reference: emptyToNull(data.reference),
		notes: emptyToNull(data.notes)
	};

	if (data.direction === 'inbound') {
		body.client_id = data.clientId?.trim() || null;
		body.vendor_id = null;
		const invoiceId = data.invoiceId?.trim();
		if (invoiceId) {
			body.allocations = [{ invoice_id: invoiceId, amount_cents: amountCents }];
		}
	} else {
		body.vendor_id = data.vendorId?.trim() || null;
		body.client_id = null;
		const billId = data.billId?.trim();
		if (billId) {
			body.allocations = [{ bill_id: billId, amount_cents: amountCents }];
		}
	}

	return body;
}

/** Create body for recording a payment against a known invoice/bill. */
export function toDocumentPaymentCreateBody(options: {
	direction: 'inbound' | 'outbound';
	clientId?: string;
	vendorId?: string;
	invoiceId?: string;
	billId?: string;
	amount: string;
	currency: string;
	method: PaymentFormData['method'];
	occurredOn: string;
	reference?: string;
	notes?: string;
}): ApiPaymentCreateBody {
	return toPaymentCreateBody({
		direction: options.direction,
		clientId: options.clientId ?? '',
		clientName: '',
		vendorId: options.vendorId ?? '',
		vendorName: '',
		invoiceId: options.invoiceId ?? '',
		billId: options.billId ?? '',
		amount: options.amount,
		currency:
			options.currency === 'USD' || options.currency === 'EUR' || options.currency === 'GBP'
				? options.currency
				: 'GBP',
		method: options.method,
		occurredOn: options.occurredOn,
		reference: options.reference ?? '',
		notes: options.notes ?? ''
	});
}
