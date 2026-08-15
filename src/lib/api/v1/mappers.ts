import type { ClientFormData, ClientResource } from '$lib/schemas/client.js';
import type { ContactFormData, ContactListItem } from '$lib/schemas/contact.js';
import type { ConvertLeadFormData, LeadFormData, LeadResource } from '$lib/schemas/lead.js';
import { leadWritableStages } from '$lib/schemas/lead.js';
import type { AiIntegrationResource } from '$lib/schemas/integration.js';
import type { MailboxAccountResource, MailboxFormData } from '$lib/schemas/mailbox.js';
import {
	emptyCalendarConnection,
	mapCalendarConnectionStatus,
	type CalendarConnectionResource,
	type CaldavFormData
} from '$lib/schemas/calendar-connection.js';
import { amountStringToCents, centsToAmountString } from '$lib/money.js';
import type {
	MembershipRole,
	OrganisationBrandingResource,
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
import {
	billingContactIdFromRecipients,
	type DocumentRecipientFormRow
} from '$lib/schemas/document-recipients.js';
import type {
	TaskAssigneeOption,
	TaskBoardStatus,
	TaskFormData,
	TaskListItem,
	TaskPriority
} from '$lib/schemas/task.js';
import type { TaskRow } from '$lib/components/crm/tasks-columns.js';
import type { EmailMessage } from '$lib/components/crm/entity-email-inbox.svelte';
import type { ClientRow } from '$lib/components/crm/clients-columns.js';
import type { EmailTemplateRow } from '$lib/components/crm/email-templates-columns.js';
import type { LeadCard } from '$lib/components/crm/leads-board.svelte';
import type { ProductRow } from '$lib/components/crm/products-columns.js';
import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';
import type { TimelineComposerSubmit } from '$lib/components/crm/timeline-composer.svelte';
import type { AuditLogListItem } from '$lib/schemas/audit-event.js';
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
	ApiCalendarCaldavPutBody,
	ApiCalendarConnection,
	ApiMailboxAccount,
	ApiMailboxPutBody,
	ApiOrganisationBranding,
	ApiOrganisationConfiguration,
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrgMember,
	ApiOrganisationMembership,
	ApiProduct,
	ApiProductCreateBody,
	ApiProductUpdateBody,
	ApiProfilePreferences,
	ApiDocumentRecipient,
	ApiDocumentRecipientInput,
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
	ApiTaskUpdateBody,
	ApiMeeting,
	ApiMeetingAttendee,
	ApiMeetingAttendeeInput,
	ApiMeetingCreateBody,
	ApiMeetingDocument,
	ApiMeetingRelatedEntityType,
	ApiMeetingStatus,
	ApiMeetingSummaryStatus,
	ApiMeetingTaskProposal,
	ApiMeetingTranscriptStatus,
	ApiMeetingUpdateBody,
	ApiProject,
	ApiProjectCard,
	ApiProjectCardCreateBody,
	ApiProjectCardUpdateBody,
	ApiProjectCreateBody,
	ApiProjectDocument,
	ApiProjectStatus,
	ApiProjectUpdateBody,
	ApiAuditEvent,
	ApiTimelineEntityType,
	ApiTimelineEvent,
	ApiTimelineEventCreateBody
} from './types.js';
import type {
	MeetingAttendeeFormData,
	MeetingFormData,
	MeetingListItem
} from '$lib/schemas/meeting.js';
import {
	INTERNAL_PROJECT_CLIENT_ID,
	isInternalProjectClientId,
	projectBoardStatuses,
	projectClientDisplayName,
	projectFormStatuses,
	type ProjectCardFormData,
	type ProjectFormData,
	type ProjectListItem
} from '$lib/schemas/project.js';
import type { InfoCardField } from '$lib/components/crm/info-card.svelte';
import type { DashboardMeeting } from '$lib/components/crm/dashboard-page.svelte';
import type { EntityProject } from '$lib/components/crm/entity-projects.svelte';
import type { ProjectWorkCard } from '$lib/components/crm/project-workspace-board.svelte';
import type { ProjectCard } from '$lib/components/crm/projects-board.svelte';

export function toOrgMembershipSummary(
	row: ApiOrganisationMembership
): OrgMembershipSummary {
	return {
		org_id: row.organisation.id,
		org_name: row.organisation.name,
		org_slug: row.organisation.slug,
		logo_url: row.organisation.logo_url ?? null,
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
		logo_url: result.organisation.logo_url ?? null,
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
		legal_name: config.legal_name,
		logo_path: config.logo_path,
		logo_url: config.logo_url ?? null,
		billing_email: config.billing_email,
		phone: config.phone,
		website_url: config.website_url,
		tax_identifier: config.tax_identifier,
		registration_number: config.registration_number,
		address_line1: config.address_line1 ?? null,
		address_line2: config.address_line2 ?? null,
		city: config.city ?? null,
		region: config.region ?? null,
		postal_code: config.postal_code ?? null,
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
		name: config.name,
		legalName: config.legal_name ?? '',
		phone: config.phone ?? '',
		billingEmail: config.billing_email ?? '',
		websiteUrl: config.website_url ?? '',
		taxIdentifier: config.tax_identifier ?? '',
		registrationNumber: config.registration_number ?? '',
		addressLine1: config.address_line1 ?? '',
		addressLine2: config.address_line2 ?? '',
		city: config.city ?? '',
		region: config.region ?? '',
		postalCode: config.postal_code ?? '',
		country: config.country_code,
		timezone: config.timezone,
		currency: config.default_currency,
		locale: config.locale,
		themeDefault: config.theme_default
	};
}

export function toOrganisationConfigPatch(data: OrganisationConfigData) {
	const emptyToNull = (value: string) => (value.trim() ? value.trim() : null);
	return {
		name: data.name.trim(),
		legal_name: emptyToNull(data.legalName),
		phone: emptyToNull(data.phone),
		billing_email: emptyToNull(data.billingEmail)?.toLowerCase() ?? null,
		website_url: emptyToNull(data.websiteUrl),
		tax_identifier: emptyToNull(data.taxIdentifier),
		registration_number: emptyToNull(data.registrationNumber),
		address_line1: emptyToNull(data.addressLine1),
		address_line2: emptyToNull(data.addressLine2),
		city: emptyToNull(data.city),
		region: emptyToNull(data.region),
		postal_code: emptyToNull(data.postalCode),
		country_code: data.country,
		timezone: data.timezone,
		default_currency: data.currency,
		locale: data.locale,
		theme_default: data.themeDefault
	};
}

export function toOrganisationBrandingResource(
	branding: ApiOrganisationBranding
): OrganisationBrandingResource {
	return {
		id: branding.id,
		version: branding.version,
		name: branding.name,
		legal_name: branding.legal_name,
		logo_path: branding.logo_path,
		logo_url: branding.logo_url,
		billing_email: branding.billing_email,
		phone: branding.phone,
		website_url: branding.website_url,
		tax_identifier: branding.tax_identifier,
		registration_number: branding.registration_number,
		address_line1: branding.address_line1,
		address_line2: branding.address_line2,
		city: branding.city,
		region: branding.region,
		postal_code: branding.postal_code,
		country_code: branding.country_code
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

export function recipientsFromDocument(doc: {
	recipients?: ApiDocumentRecipient[];
	contact_id?: string | null;
}): DocumentRecipientFormRow[] {
	const rows = Array.isArray(doc.recipients) ? doc.recipients : [];
	if (rows.length > 0) {
		return [...rows]
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
			.map((row) => ({
				contactId: row.contact_id,
				isBilling: Boolean(row.is_billing)
			}));
	}
	if (doc.contact_id) {
		return [{ contactId: doc.contact_id, isBilling: true }];
	}
	return [];
}

export function recipientsToApiInput(
	recipients: DocumentRecipientFormRow[]
): ApiDocumentRecipientInput[] {
	return recipients.map((row) => ({
		contact_id: row.contactId,
		is_billing: row.isBilling
	}));
}

function recipientsWritableFields(recipients: DocumentRecipientFormRow[]): {
	recipients: ApiDocumentRecipientInput[];
	contact_id: string | null;
} {
	return {
		recipients: recipientsToApiInput(recipients),
		contact_id: billingContactIdFromRecipients(recipients)
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
		discount: centsToAmountString(quote.discount_cents) || '',
		status,
		recipients: recipientsFromDocument(quote)
	};
}

export function toQuoteCreateBody(data: QuoteFormData): ApiQuoteCreateBody {
	return {
		title: data.title.trim(),
		client_id: data.clientId,
		currency: data.currency,
		discount_cents: amountStringToCents(data.discount?.trim() || '') ?? 0,
		...recipientsWritableFields(data.recipients),
		lines: []
	};
}

export function toQuoteUpdateBody(data: QuoteFormData): ApiQuoteUpdateBody {
	return {
		title: data.title.trim(),
		client_id: data.clientId,
		currency: data.currency,
		discount_cents: amountStringToCents(data.discount?.trim() || '') ?? 0,
		...recipientsWritableFields(data.recipients)
	};
}

export function productStatusLabel(status: ApiProduct['status']): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function toProductRow(product: ApiProduct, categoryName?: string | null): ProductRow {
	return {
		id: product.id,
		sku: product.sku,
		name: product.name,
		category: categoryName?.trim() || undefined,
		unitPrice: formatMoney(product.unit_price_cents, product.currency),
		stock: product.track_stock ? product.stock_qty : undefined,
		lowStockAt: product.low_stock_at ?? undefined,
		status: productStatusLabel(product.status)
	};
}

export function toCatalogProductOption(
	product: ApiProduct,
	taxRates?: { id: string; rate_percent: number }[]
): CatalogProductOption {
	const rate = product.tax_rate_id
		? taxRates?.find((r) => r.id === product.tax_rate_id)
		: undefined;
	return {
		id: product.id,
		sku: product.sku,
		name: product.name,
		unitPrice: centsToAmountString(product.unit_price_cents) || '0',
		taxRateId: product.tax_rate_id,
		taxRatePercent: rate != null ? String(rate.rate_percent) : undefined
	};
}

export function toProductFormData(product: ApiProduct): ProductFormData {
	return {
		sku: product.sku,
		name: product.name,
		description: product.description ?? '',
		categoryId: product.category_id ?? '',
		unitPrice: centsToAmountString(product.unit_price_cents) || '0',
		taxRateId: product.tax_rate_id ?? '',
		trackStock: product.track_stock,
		stockQty: product.track_stock ? String(product.stock_qty) : '',
		status: product.status
	};
}

export function toProductCreateBody(data: ProductFormData): ApiProductCreateBody {
	const taxRateId = data.taxRateId?.trim();
	const categoryId = data.categoryId?.trim();
	return {
		sku: data.sku.trim(),
		name: data.name.trim(),
		description: data.description?.trim() || null,
		category_id: categoryId ? categoryId : null,
		product_type: 'product',
		unit_price_cents: amountStringToCents(data.unitPrice) ?? 0,
		currency: 'GBP',
		tax_rate_id: taxRateId ? taxRateId : null,
		track_stock: data.trackStock,
		status: data.status
	};
}

export function toProductUpdateBody(data: ProductFormData): ApiProductUpdateBody {
	const taxRateId = data.taxRateId?.trim();
	const categoryId = data.categoryId?.trim();
	return {
		sku: data.sku.trim(),
		name: data.name.trim(),
		description: data.description?.trim() || null,
		category_id: categoryId ? categoryId : null,
		unit_price_cents: amountStringToCents(data.unitPrice) ?? 0,
		tax_rate_id: taxRateId ? taxRateId : null,
		track_stock: data.trackStock,
		status: data.status
	};
}

function lineTaxRatePercent(data: LineItemFormData): number | undefined {
	const raw = data.taxRatePercent?.trim();
	if (!raw) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

function lineDiscountPercent(data: LineItemFormData): number {
	const raw = data.discountPercent?.trim();
	if (!raw) return 0;
	const value = Number(raw);
	return Number.isFinite(value) ? value : 0;
}

export function toQuoteLineInput(data: LineItemFormData, position?: number): ApiQuoteLineInput {
	const quantity = Number(data.qty);
	const unitPriceCents = amountStringToCents(data.unitPrice) ?? 0;
	const productId = data.productId?.trim();
	const taxRatePercent = lineTaxRatePercent(data);
	const tax = taxRatePercent === undefined ? {} : { tax_rate_percent: taxRatePercent };
	const discount_percent = lineDiscountPercent(data);
	if (productId) {
		return {
			product_id: productId,
			quantity,
			description: data.description.trim(),
			unit_price_cents: unitPriceCents,
			discount_percent,
			...tax,
			...(position === undefined ? {} : { position })
		};
	}
	return {
		product_id: null,
		description: data.description.trim(),
		quantity,
		unit_price_cents: unitPriceCents,
		discount_percent,
		...tax,
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
		input.discount_percent = line.discountPercent ?? 0;
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
		currency,
		issueOn: invoice.issue_on,
		dueOn: invoice.due_on,
		purchaseOrderNumber: invoice.purchase_order_number ?? '',
		discount: centsToAmountString(invoice.discount_cents) || '',
		status,
		quoteId: invoice.quote_id ?? '',
		recipients: recipientsFromDocument(invoice)
	};
}

export function toInvoiceCreateBody(data: InvoiceFormData): ApiInvoiceCreateBody {
	return {
		client_id: data.clientId,
		currency: data.currency,
		issue_on: data.issueOn,
		due_on: data.dueOn,
		purchase_order_number: data.purchaseOrderNumber?.trim() || null,
		discount_cents: amountStringToCents(data.discount?.trim() || '') ?? 0,
		...recipientsWritableFields(data.recipients),
		lines: []
	};
}

export function toInvoiceUpdateBody(data: InvoiceFormData): ApiInvoiceUpdateBody {
	return {
		client_id: data.clientId,
		currency: data.currency,
		issue_on: data.issueOn,
		due_on: data.dueOn,
		purchase_order_number: data.purchaseOrderNumber?.trim() || null,
		discount_cents: amountStringToCents(data.discount?.trim() || '') ?? 0,
		...recipientsWritableFields(data.recipients)
	};
}

export function toInvoiceLineInput(data: LineItemFormData, position?: number): ApiInvoiceLineInput {
	const quantity = Number(data.qty);
	const unitPriceCents = amountStringToCents(data.unitPrice) ?? 0;
	const productId = data.productId?.trim();
	const taxRatePercent = lineTaxRatePercent(data);
	const tax = taxRatePercent === undefined ? {} : { tax_rate_percent: taxRatePercent };
	const discount_percent = lineDiscountPercent(data);
	if (productId) {
		return {
			product_id: productId,
			quantity,
			description: data.description.trim(),
			unit_price_cents: unitPriceCents,
			discount_percent,
			...tax,
			...(position === undefined ? {} : { position })
		};
	}
	return {
		product_id: null,
		description: data.description.trim(),
		quantity,
		unit_price_cents: unitPriceCents,
		discount_percent,
		...tax,
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
		input.discount_percent = line.discountPercent ?? 0;
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
	const taxRatePercent = lineTaxRatePercent(data);
	const tax = taxRatePercent === undefined ? {} : { tax_rate_percent: taxRatePercent };
	const discount_percent = lineDiscountPercent(data);
	if (productId) {
		return {
			product_id: productId,
			quantity,
			description: data.description.trim(),
			unit_price_cents: unitPriceCents,
			discount_percent,
			...tax,
			...(position === undefined ? {} : { position })
		};
	}
	return {
		product_id: null,
		description: data.description.trim(),
		quantity,
		unit_price_cents: unitPriceCents,
		discount_percent,
		...tax,
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
		input.discount_percent = line.discountPercent ?? 0;
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
		tax_exempt: Boolean(client.tax_exempt),
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
		taxExempt: Boolean(client.tax_exempt),
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
		tax_exempt: Boolean(data.taxExempt),
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
		primary_email: lead.primary_email,
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
		primaryEmail: lead.primary_email ?? '',
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
		primary_email: emptyToNull(data.primaryEmail),
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
		auth_mode: account.auth_mode === 'oauth' ? 'oauth' : 'password',
		oauth_provider:
			account.oauth_provider === 'microsoft' || account.oauth_provider === 'google'
				? account.oauth_provider
				: null,
		last_checked_at: account.last_checked_at,
		last_error_code: account.last_error_code
	};
}

export function toCalendarConnectionResource(
	connection: ApiCalendarConnection | null | undefined
): CalendarConnectionResource {
	if (!connection) return emptyCalendarConnection();
	const config = (connection.config ?? {}) as {
		account_email?: string | null;
		calendar_id?: string | null;
		caldav_url?: string | null;
		username?: string | null;
	};
	const provider =
		connection.provider === 'caldav' || connection.provider === 'google'
			? connection.provider
			: null;
	const email =
		connection.account_email?.trim() ||
		config.account_email?.trim() ||
		config.username?.trim() ||
		null;
	const caldavUrl =
		connection.caldav_url?.trim() || config.caldav_url?.trim() || null;
	const calendarId =
		connection.calendar_id?.trim() || config.calendar_id?.trim() || null;
	return {
		provider,
		credentials_configured: Boolean(connection.credentials_configured),
		status: mapCalendarConnectionStatus(connection.status),
		account_label: email,
		caldav_url: provider === 'caldav' ? caldavUrl : null,
		calendar_id: calendarId,
		last_error_code: connection.last_error_code ?? null,
		last_checked_at: connection.last_sync_at ?? null
	};
}

export function toCaldavPutBody(data: CaldavFormData): ApiCalendarCaldavPutBody {
	const body: ApiCalendarCaldavPutBody = {
		provider: 'caldav',
		caldav_url: data.caldavUrl.trim(),
		username: data.username.trim(),
		calendar_id: emptyToNull(data.calendarId)
	};
	const password = data.password.trim();
	if (password) body.password = password;
	return body;
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
		selected_model: item.selected_model?.trim() ? item.selected_model.trim() : null,
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

/** Prefer `GET /me/org-members` so assignees include teammates, not only “Me”. */
export function assigneeOptionsFromOrgMembers(
	members: ApiOrgMember[],
	currentMembershipId?: string | null
): TaskAssigneeOption[] {
	return members.map((member) => ({
		id: member.membership_id,
		label:
			currentMembershipId && member.membership_id === currentMembershipId
				? 'Me'
				: member.display_name
	}));
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

/** Map a list item into the Storyboard My tasks / dashboard panel shape. */
export function toDashboardTask(item: TaskListItem): {
	id: string;
	title: string;
	relatedTo?: string;
	dueOn: string;
	status: string;
	priority?: TaskPriority;
} {
	return {
		id: item.id,
		title: item.title,
		relatedTo: item.relatedTo === '—' ? undefined : item.relatedTo,
		dueOn: item.dueOn === '—' ? '—' : item.dueOn,
		status: item.status,
		priority: item.rawPriority
	};
}

/** Open tasks whose due date is before today (UTC date). */
export function isTaskDueBeforeToday(dueAt: string | null, now = new Date()): boolean {
	if (!dueAt) return false;
	const dueDay = dueAt.slice(0, 10);
	if (!dueDay) return false;
	const today = now.toISOString().slice(0, 10);
	return dueDay < today;
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
	const fromName = row.from_name?.trim() || null;
	return {
		id: row.id,
		direction: row.direction === 'outbound' ? 'out' : 'in',
		from: fromName || row.from_address,
		fromAddress: row.from_address,
		fromName,
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
		recipients: [],
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
		recipients: recipientsFromDocument(document),
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
		...recipientsWritableFields(data.recipients),
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
	const quantity = Number(data.qty);
	if (!Number.isFinite(quantity) || quantity <= 0) {
		throw new Error('Invalid quantity');
	}
	const taxRaw = data.taxRatePercent?.trim();
	const taxRate = taxRaw ? Number(taxRaw) : 0;
	if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
		throw new Error('Invalid tax rate');
	}
	const input: ApiRecurringInvoiceLineInput = {
		description_template: data.descriptionTemplate.trim(),
		quantity,
		unit_price_cents: unitCents,
		discount_percent: 0,
		tax_rate_percent: taxRate,
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
		status: run.status,
		periodStart: run.period_start,
		periodEnd: run.period_end,
		invoiceId: linked?.id ?? run.invoice_id ?? null,
		invoiceNumber: linked?.number ?? run.invoice_number ?? null,
		errorMessage: run.error_message
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

function formatTimelineOccurredAt(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function timelineActorLabel(row: ApiTimelineEvent): string | undefined {
	const named = row.payload?.actor_name;
	if (typeof named === 'string' && named.trim()) return named.trim();
	if (row.actor_type === 'system') return 'System';
	if (row.actor_type === 'agent') return 'Agent';
	if (row.actor_type === 'integration') return 'Integration';
	if (row.actor_type === 'user') return 'Team';
	return undefined;
}

const ENTITY_TIMELINE_PATH: Record<ApiTimelineEntityType, string> = {
	contact: 'contacts',
	lead: 'leads',
	client: 'clients',
	quote: 'quotes',
	invoice: 'invoices',
	bill: 'bills'
};

/** Profile href for a timeline entity row (org Home deep-links). */
export function entityTimelineHref(
	entityType: string,
	entityId: string,
	timelineEventId?: string
): string | undefined {
	const segment = ENTITY_TIMELINE_PATH[entityType as ApiTimelineEntityType];
	if (!segment || !entityId) return undefined;
	const base = `/${segment}/${entityId}`;
	if (!timelineEventId) return base;
	return `${base}?timeline=${encodeURIComponent(timelineEventId)}`;
}

/** Map API timeline row → FE `TimelineEvent` card model. */
export function toTimelineEvent(row: ApiTimelineEvent): TimelineEvent {
	const accent = row.payload?.accent;
	const icon = row.payload?.icon;
	const kindIcon = typeof row.kind === 'string' ? row.kind : undefined;
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		body: row.body?.trim() ? row.body : undefined,
		occurredAt: formatTimelineOccurredAt(row.occurred_at),
		actor: timelineActorLabel(row),
		accent: typeof accent === 'string' ? accent : undefined,
		// System writers often omit payload.icon — fall back to kind so conversion/status cards aren't bare.
		icon: typeof icon === 'string' ? icon : kindIcon,
		entityType: row.entity_type,
		entityId: row.entity_id,
		href: entityTimelineHref(row.entity_type, row.entity_id)
	};
}

/** Map composer submit → create body (accent/icon/mentions in payload). */
export function toTimelineEventCreateBody(
	submit: TimelineComposerSubmit
): ApiTimelineEventCreateBody {
	const mentions = (submit.mentions ?? [])
		.filter((m) => m.membership_id && m.display_name)
		.slice(0, 20);
	return {
		kind: submit.kind,
		title: submit.title,
		body: submit.body.trim() ? submit.body : null,
		payload: {
			accent: submit.accent,
			icon: submit.icon,
			...(mentions.length > 0 ? { mentions } : {})
		}
	};
}

function shortId(id: string | null | undefined): string {
	if (!id) return '—';
	return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Humanize `resource.verb` action codes for the audit table. */
export function auditActionLabel(action: string): string {
	const trimmed = action.trim();
	if (!trimmed) return '—';
	return trimmed
		.split(/[._]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function auditActorLabel(row: ApiAuditEvent): string {
	const named = row.metadata?.actor_name;
	if (typeof named === 'string' && named.trim()) return named.trim();
	const typeLabel =
		row.actor_type === 'user'
			? 'User'
			: row.actor_type === 'agent'
				? 'Agent'
				: row.actor_type === 'api_key'
					? 'API key'
					: row.actor_type === 'system'
						? 'System'
						: row.actor_type || 'Actor';
	if (row.actor_id) return `${typeLabel} · ${shortId(row.actor_id)}`;
	return typeLabel;
}

function auditTargetLabel(row: ApiAuditEvent): string {
	const type = row.resource_type?.trim() || 'resource';
	if (!row.resource_id) return type;
	return `${type} · ${shortId(row.resource_id)}`;
}

/** Map API audit row → FE table model. */
export function toAuditLogListItem(row: ApiAuditEvent): AuditLogListItem {
	return {
		id: row.id,
		occurredAt: formatTimelineOccurredAt(row.created_at),
		actor: auditActorLabel(row),
		event: auditActionLabel(row.action),
		action: row.action,
		target: auditTargetLabel(row),
		ip: row.ip_address?.trim() ? row.ip_address : '—'
	};
}

export function meetingStatusLabel(status: ApiMeetingStatus): string {
	if (status === 'in_progress') return 'In progress';
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function meetingTranscriptStatusLabel(status: ApiMeetingTranscriptStatus): string {
	if (status === 'none') return 'Missing';
	if (status === 'uploaded') return 'Uploaded';
	if (status === 'processing') return 'Processing';
	if (status === 'ready') return 'Ready';
	if (status === 'failed') return 'Failed';
	return status;
}

export function meetingSummaryStatusLabel(status: ApiMeetingSummaryStatus): string {
	if (status === 'none') return 'Missing';
	if (status === 'generating') return 'Generating';
	if (status === 'ready') return 'Ready';
	if (status === 'failed') return 'Failed';
	return status;
}

export function meetingTranscriptPlainText(meeting: ApiMeetingDocument): string {
	return meeting.transcript?.plain_text?.trim() || '';
}

export function toProposedMeetingTasks(
	proposals: ApiMeetingTaskProposal[] | null | undefined
): Array<{
	id: string;
	title: string;
	assignee?: string;
	status: 'proposed' | 'accepted' | 'dismissed';
	accepted: boolean;
}> {
	if (!proposals?.length) return [];
	return proposals.map((proposal) => ({
		id: proposal.id,
		title: proposal.title,
		assignee: proposal.suggested_assignee_label?.trim() || undefined,
		status: proposal.status,
		accepted: proposal.status === 'accepted'
	}));
}

export function canGenerateMeetingSummary(meeting: ApiMeetingDocument): boolean {
	if (meeting.summary_status === 'generating') return false;
	if (meeting.transcript?.plain_text?.trim()) return true;
	return meeting.transcript_status === 'ready';
}

export function formatMeetingWhen(
	startsAt: string,
	endsAt: string,
	timezone?: string | null
): string {
	const start = new Date(startsAt);
	const end = new Date(endsAt);
	if (Number.isNaN(start.getTime())) return startsAt || '—';
	const tz = timezone?.trim() || undefined;
	const dateOpts: Intl.DateTimeFormatOptions = {
		dateStyle: 'medium',
		timeStyle: 'short',
		...(tz ? { timeZone: tz } : {})
	};
	try {
		const startLabel = start.toLocaleString(undefined, dateOpts);
		if (Number.isNaN(end.getTime())) return startLabel;
		const endLabel = end.toLocaleTimeString(undefined, {
			timeStyle: 'short',
			...(tz ? { timeZone: tz } : {})
		});
		return `${startLabel}–${endLabel}`;
	} catch {
		return startsAt;
	}
}

function meetingWithWhom(meeting: ApiMeeting): string {
	const attendees = meeting.attendees;
	if (attendees?.length) {
		const organiser = attendees.find((a) => a.organiser);
		const primary = organiser ?? attendees[0];
		const name = primary.name?.trim();
		if (name) return name;
		if (primary.email) return primary.email;
	}
	// List payloads omit nested attendees — fall back to location when present.
	const location = meeting.location?.trim();
	return location || '—';
}

function meetingRelatedLabel(meeting: ApiMeeting): string {
	const label = meeting.related_entity_label?.trim();
	if (label) return label;
	if (meeting.related_entity_type) {
		const type = meeting.related_entity_type;
		return type.charAt(0).toUpperCase() + type.slice(1);
	}
	return '—';
}

export function toMeetingListItem(meeting: ApiMeeting): MeetingListItem {
	return {
		id: meeting.id,
		title: meeting.title,
		when: formatMeetingWhen(meeting.starts_at, meeting.ends_at, meeting.timezone),
		withWhom: meetingWithWhom(meeting),
		relatedTo: meetingRelatedLabel(meeting),
		status: meetingStatusLabel(meeting.status),
		version: meeting.version,
		rawStatus: meeting.status,
		startsAt: meeting.starts_at,
		endsAt: meeting.ends_at,
		timezone: meeting.timezone,
		calendarProvider: meeting.calendar_provider ?? null,
		externalEventId: meeting.external_event_id ?? null
	};
}

export function toDashboardMeeting(item: MeetingListItem): DashboardMeeting {
	return {
		id: item.id,
		title: item.title,
		when: item.when,
		withWhom: item.withWhom
	};
}

export function toAttendeeFields(attendees: ApiMeetingAttendee[]): InfoCardField[] {
	if (attendees.length === 0) {
		return [{ label: 'Attendees', value: 'None yet' }];
	}
	return attendees.map((attendee, index) => {
		const name = attendee.name?.trim();
		const value = name ? `${name} · ${attendee.email}` : attendee.email;
		const label = attendee.organiser ? 'Organiser' : `Guest ${index + 1}`;
		return { label, value };
	});
}

function defaultMeetingTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

/** datetime-local ← ISO timestamptz (browser local wall clock). */
export function isoToLocalDatetime(iso: string | null | undefined): string {
	if (!iso) return '';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO timestamptz ← datetime-local (browser local interpretation). */
export function localDatetimeToIso(local: string): string {
	const trimmed = local.trim();
	if (!trimmed) return '';
	const date = new Date(trimmed);
	if (Number.isNaN(date.getTime())) return trimmed;
	return date.toISOString();
}

export function emptyMeetingFormData(): MeetingFormData {
	return {
		title: '',
		startsAt: '',
		endsAt: '',
		timezone: defaultMeetingTimezone(),
		location: '',
		meetingUrl: '',
		relatedEntityType: 'none',
		relatedEntityId: '',
		attendees: [],
		status: 'scheduled'
	};
}

export function toMeetingFormData(meeting: ApiMeetingDocument): MeetingFormData {
	const relatedType =
		meeting.related_entity_type === 'client' ||
		meeting.related_entity_type === 'contact' ||
		meeting.related_entity_type === 'lead' ||
		meeting.related_entity_type === 'project'
			? meeting.related_entity_type
			: 'none';
	return {
		title: meeting.title,
		startsAt: isoToLocalDatetime(meeting.starts_at),
		endsAt: isoToLocalDatetime(meeting.ends_at),
		timezone: meeting.timezone || defaultMeetingTimezone(),
		location: meeting.location ?? '',
		meetingUrl: meeting.meeting_url ?? '',
		relatedEntityType: relatedType,
		relatedEntityId: relatedType !== 'none' ? (meeting.related_entity_id ?? '') : '',
		attendees: (meeting.attendees ?? []).map((a) => ({
			email: a.email,
			name: a.name ?? '',
			contactId: a.contact_id ?? '',
			membershipId: a.membership_id ?? '',
			organiser: a.organiser
		})),
		status: meeting.status
	};
}

function toAttendeeInputs(attendees: MeetingAttendeeFormData[]): ApiMeetingAttendeeInput[] {
	return attendees
		.map((a) => ({
			email: a.email.trim(),
			name: a.name?.trim() ? a.name.trim() : null,
			contact_id: a.contactId?.trim() ? a.contactId.trim() : null,
			membership_id: a.membershipId?.trim() ? a.membershipId.trim() : null,
			organiser: Boolean(a.organiser)
		}))
		.filter((a) => a.email);
}

function relatedEntityFromForm(data: MeetingFormData): {
	related_entity_type: ApiMeetingRelatedEntityType | null;
	related_entity_id: string | null;
} {
	const type = data.relatedEntityType;
	const id = data.relatedEntityId?.trim() || '';
	if (type === 'none' || !id) {
		return { related_entity_type: null, related_entity_id: null };
	}
	return { related_entity_type: type, related_entity_id: id };
}

export function toMeetingCreateBody(data: MeetingFormData): ApiMeetingCreateBody {
	const related = relatedEntityFromForm(data);
	return {
		title: data.title.trim(),
		status: data.status,
		starts_at: localDatetimeToIso(data.startsAt),
		ends_at: localDatetimeToIso(data.endsAt),
		timezone: data.timezone.trim() || defaultMeetingTimezone(),
		location: data.location?.trim() ? data.location.trim() : null,
		meeting_url: data.meetingUrl?.trim() ? data.meetingUrl.trim() : null,
		related_entity_type: related.related_entity_type,
		related_entity_id: related.related_entity_id,
		attendees: toAttendeeInputs(data.attendees ?? [])
	};
}

export function toMeetingUpdateBody(data: MeetingFormData): ApiMeetingUpdateBody {
	return toMeetingCreateBody(data);
}

export function projectStatusLabel(status: ApiProjectStatus): string {
	switch (status) {
		case 'planning':
			return 'Planning';
		case 'active':
			return 'Active';
		case 'blocked':
			return 'Blocked';
		case 'done':
			return 'Done';
		case 'archived':
			return 'Archived';
		default:
			return status;
	}
}

export function emptyProjectFormData(): ProjectFormData {
	return {
		name: '',
		clientId: INTERNAL_PROJECT_CLIENT_ID,
		description: '',
		status: 'planning'
	};
}

export function toProjectFormData(project: ApiProject): ProjectFormData {
	const status = projectFormStatuses.includes(
		project.status as (typeof projectFormStatuses)[number]
	)
		? (project.status as ProjectFormData['status'])
		: 'planning';
	return {
		name: project.name,
		clientId: project.client_id ?? INTERNAL_PROJECT_CLIENT_ID,
		description: project.description ?? '',
		status
	};
}

function projectClientIdToApi(clientId: string): string | null {
	const trimmed = clientId.trim();
	return isInternalProjectClientId(trimmed) ? null : trimmed;
}

export function toProjectCreateBody(data: ProjectFormData): ApiProjectCreateBody {
	return {
		client_id: projectClientIdToApi(data.clientId),
		name: data.name.trim(),
		description: data.description?.trim() ? data.description.trim() : null,
		status: data.status === 'archived' ? 'planning' : data.status
	};
}

export function toProjectUpdateBody(data: ProjectFormData): ApiProjectUpdateBody {
	return {
		client_id: projectClientIdToApi(data.clientId),
		name: data.name.trim(),
		description: data.description?.trim() ? data.description.trim() : null,
		status: data.status
	};
}

export function emptyProjectCardFormData(): ProjectCardFormData {
	return {
		title: '',
		description: '',
		dueAt: ''
	};
}

export function toProjectCardFormData(card: ApiProjectCard): ProjectCardFormData {
	return {
		title: card.title,
		description: card.description ?? '',
		dueAt: dueAtToForm(card.due_at)
	};
}

export function toProjectCardCreateBody(data: ProjectCardFormData): ApiProjectCardCreateBody {
	return {
		title: data.title.trim(),
		description: data.description?.trim() ? data.description.trim() : null,
		due_at: dueOnToApi(data.dueAt)
	};
}

export function toProjectCardUpdateBody(data: ProjectCardFormData): ApiProjectCardUpdateBody {
	return {
		title: data.title.trim(),
		description: data.description?.trim() ? data.description.trim() : null,
		due_at: dueOnToApi(data.dueAt)
	};
}

export function toProjectListItem(project: ApiProject): ProjectListItem {
	const status = projectBoardStatuses.includes(project.status as (typeof projectBoardStatuses)[number])
		? (project.status as (typeof projectBoardStatuses)[number])
		: 'planning';
	const cardCount = project.columns?.reduce((sum, col) => sum + (col.cards?.length ?? 0), 0);
	return {
		id: project.id,
		name: project.name,
		clientId: project.client_id ?? INTERNAL_PROJECT_CLIENT_ID,
		clientName: projectClientDisplayName(project),
		cardCount,
		stage: status,
		version: project.version,
		position: project.position,
		rawStatus: project.status
	};
}

export function toProjectBoardCard(item: ProjectListItem): ProjectCard {
	return {
		id: item.id,
		name: item.name,
		clientId: item.clientId,
		clientName: item.clientName,
		owner: item.owner,
		cardCount: item.cardCount,
		stage: item.stage,
		version: item.version,
		position: item.position
	};
}

export function toEntityProject(project: ApiProject): EntityProject {
	const cardCount = project.columns?.reduce((sum, col) => sum + (col.cards?.length ?? 0), 0);
	return {
		id: project.id,
		name: project.name,
		status: projectStatusLabel(project.status),
		cardCount,
		updatedAt: project.updated_at
	};
}

export function toWorkspaceCards(project: ApiProjectDocument): ProjectWorkCard[] {
	const cards: ProjectWorkCard[] = [];
	for (const column of project.columns ?? []) {
		for (const card of column.cards ?? []) {
			cards.push(toWorkspaceCard(card, column.id));
		}
	}
	return cards.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function toWorkspaceCard(card: ApiProjectCard, columnId = card.column_id): ProjectWorkCard {
	return {
		id: card.id,
		title: card.title,
		description: card.description?.trim() || undefined,
		column: columnId,
		dueOn: card.due_at ? card.due_at.slice(0, 10) : undefined,
		version: card.version,
		position: card.position
	};
}

export function workspaceColumnsFromProject(
	project: ApiProjectDocument
): { id: string; label: string }[] {
	return [...(project.columns ?? [])]
		.sort((a, b) => a.position - b.position)
		.map((col) => ({ id: col.id, label: col.name }));
}
