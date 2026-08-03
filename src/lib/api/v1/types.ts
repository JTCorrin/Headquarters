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

export type ApiProductType = 'product' | 'service';
export type ApiProductStatus = 'active' | 'archived';

export interface ApiProduct {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	sku: string;
	name: string;
	description: string | null;
	category_id: string | null;
	product_type: ApiProductType;
	unit_name: string | null;
	unit_price_cents: number;
	cost_price_cents: number | null;
	currency: string;
	tax_rate_id: string | null;
	track_stock: boolean;
	stock_qty: number;
	low_stock_at: number | null;
	status: ApiProductStatus;
	metadata: unknown;
}

export interface ApiProductCreateBody {
	sku: string;
	name: string;
	description?: string | null;
	category_id?: string | null;
	product_type?: ApiProductType;
	unit_name?: string | null;
	unit_price_cents: number;
	cost_price_cents?: number | null;
	currency?: string;
	tax_rate_id?: string | null;
	track_stock?: boolean;
	low_stock_at?: number | null;
	status?: ApiProductStatus;
	metadata?: unknown;
}

export type ApiProductUpdateBody = Partial<ApiProductCreateBody>;

export interface ApiProductListParams {
	limit?: number;
	cursor?: string;
	status?: ApiProductStatus;
}

export type ApiProductAdjustReason =
	| 'opening'
	| 'adjustment'
	| 'invoice'
	| 'return'
	| 'void';

export interface ApiProductAdjustStockBody {
	quantity_delta: number;
	reason?: ApiProductAdjustReason;
	note?: string | null;
	occurred_at?: string;
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

/** Product line — description/unit price may be inherited server-side from the product. */
export interface ApiQuoteProductLineInput {
	product_id: string;
	quantity: number;
	description?: string;
	unit_price_cents?: number;
	discount_percent?: number;
	tax_rate_percent?: number;
	position?: number;
}

/** Free-text line — description and unit_price_cents are required by the API. */
export interface ApiQuoteFreeTextLineInput {
	product_id?: null;
	description: string;
	quantity: number;
	unit_price_cents: number;
	discount_percent?: number;
	tax_rate_percent?: number;
	position?: number;
}

export type ApiQuoteLineInput = ApiQuoteProductLineInput | ApiQuoteFreeTextLineInput;

interface ApiQuoteWritableFields {
	currency?: string;
	contact_id?: string | null;
	owner_membership_id?: string | null;
	issue_on?: string;
	valid_until?: string | null;
	discount_cents?: number;
	terms?: string | null;
	notes?: string | null;
	internal_notes?: string | null;
}

/**
 * Create requires a party: client_id or lead_id (server also rejects neither).
 * Runtime cross-field checks remain server-owned.
 */
export type ApiQuoteCreateBody = ApiQuoteWritableFields & {
	title: string;
	lines: ApiQuoteLineInput[];
} & (
	| { client_id: string; lead_id?: null }
	| { lead_id: string; client_id?: null }
);

export type ApiQuoteUpdateBody = ApiQuoteWritableFields & {
	title?: string;
	client_id?: string | null;
	lead_id?: string | null;
	lines?: ApiQuoteLineInput[];
};

export interface ApiQuoteListParams {
	limit?: number;
	cursor?: string;
	/** Optional status filter (`draft` or `accepted`). */
	status?: 'draft' | 'accepted';
}

export type ApiInvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'void';
export type ApiInvoiceSource = 'manual' | 'quote' | 'recurring';

export interface ApiInvoice {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	number: string;
	client_id: string;
	contact_id: string | null;
	quote_id: string | null;
	owner_membership_id: string | null;
	source: ApiInvoiceSource;
	recurring_run_id: string | null;
	billing_period_start: string | null;
	billing_period_end: string | null;
	status: ApiInvoiceStatus;
	currency: string;
	issue_on: string;
	due_on: string;
	purchase_order_number: string | null;
	subtotal_cents: number;
	discount_cents: number;
	tax_cents: number;
	total_cents: number;
	paid_cents: number;
	balance_due_cents: number;
	party_snapshot: unknown;
	payment_terms: string | null;
	notes: string | null;
	internal_notes: string | null;
	sent_at: string | null;
	viewed_at: string | null;
	paid_at: string | null;
	voided_at: string | null;
	void_reason: string | null;
}

export interface ApiInvoiceLine {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	version: number;
	invoice_id: string;
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

export type ApiInvoiceDocument = ApiInvoice & { lines: ApiInvoiceLine[] };

/** Product line — description/unit price may be inherited server-side from the product. */
export interface ApiInvoiceProductLineInput {
	product_id: string;
	quantity: number;
	description?: string;
	unit_price_cents?: number;
	discount_percent?: number;
	tax_rate_percent?: number;
	position?: number;
}

/** Free-text line — description and unit_price_cents are required by the API. */
export interface ApiInvoiceFreeTextLineInput {
	product_id?: null;
	description: string;
	quantity: number;
	unit_price_cents: number;
	discount_percent?: number;
	tax_rate_percent?: number;
	position?: number;
}

export type ApiInvoiceLineInput = ApiInvoiceProductLineInput | ApiInvoiceFreeTextLineInput;

interface ApiInvoiceWritableFields {
	currency?: string;
	contact_id?: string | null;
	owner_membership_id?: string | null;
	issue_on?: string;
	due_on?: string;
	purchase_order_number?: string | null;
	discount_cents?: number;
	payment_terms?: string | null;
	notes?: string | null;
	internal_notes?: string | null;
}

export type ApiInvoiceCreateBody = ApiInvoiceWritableFields & {
	client_id: string;
	lines: ApiInvoiceLineInput[];
};

export type ApiInvoiceUpdateBody = ApiInvoiceWritableFields & {
	client_id?: string;
	lines?: ApiInvoiceLineInput[];
};

export interface ApiInvoiceFromQuoteBody {
	quote_id: string;
}

export interface ApiInvoiceVoidBody {
	void_reason: string;
}

export interface ApiInvoiceListParams {
	limit?: number;
	cursor?: string;
	/** Optional user-selected status filter; omit to list all statuses. */
	status?: ApiInvoiceStatus;
}

export type ApiVendorStatus = 'active' | 'inactive' | 'archived';

export interface ApiVendor {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	name: string;
	status: ApiVendorStatus;
	primary_email: string | null;
	phone: string | null;
	website_url: string | null;
	tax_identifier: string | null;
	default_currency: string | null;
	payment_terms_days: number | null;
	notes: string | null;
	metadata: Record<string, unknown>;
}

export interface ApiVendorListParams {
	limit?: number;
	cursor?: string;
}

export interface ApiVendorCreateBody {
	name: string;
	status?: ApiVendorStatus;
	primary_email?: string | null;
	phone?: string | null;
	website_url?: string | null;
	tax_identifier?: string | null;
	default_currency?: string | null;
	payment_terms_days?: number | null;
	notes?: string | null;
	metadata?: Record<string, unknown>;
}

export type ApiVendorUpdateBody = Partial<ApiVendorCreateBody>;

export type ApiBillStatus = 'draft' | 'received' | 'scheduled' | 'partial' | 'paid' | 'void';

export interface ApiBill {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	vendor_id: string;
	number: string;
	internal_reference: string | null;
	status: ApiBillStatus;
	currency: string;
	issue_on: string | null;
	received_on: string | null;
	due_on: string;
	scheduled_payment_on: string | null;
	subtotal_cents: number;
	discount_cents: number;
	tax_cents: number;
	total_cents: number;
	paid_cents: number;
	balance_due_cents: number;
	party_snapshot: unknown;
	notes: string | null;
	attachment_document_id: string | null;
	paid_at: string | null;
	voided_at: string | null;
	void_reason: string | null;
}

export interface ApiBillLine {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	version: number;
	bill_id: string;
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

export type ApiBillDocument = ApiBill & { lines: ApiBillLine[] };

export interface ApiBillProductLineInput {
	product_id: string;
	quantity: number;
	description?: string;
	unit_price_cents?: number;
	discount_percent?: number;
	tax_rate_percent?: number;
	position?: number;
}

export interface ApiBillFreeTextLineInput {
	product_id?: null;
	description: string;
	quantity: number;
	unit_price_cents: number;
	discount_percent?: number;
	tax_rate_percent?: number;
	position?: number;
}

export type ApiBillLineInput = ApiBillProductLineInput | ApiBillFreeTextLineInput;

interface ApiBillWritableFields {
	currency?: string;
	internal_reference?: string | null;
	issue_on?: string | null;
	received_on?: string | null;
	due_on?: string;
	notes?: string | null;
}

export type ApiBillCreateBody = ApiBillWritableFields & {
	vendor_id: string;
	number: string;
	lines: ApiBillLineInput[];
};

export type ApiBillUpdateBody = ApiBillWritableFields & {
	vendor_id?: string;
	number?: string;
	lines?: ApiBillLineInput[];
};

export interface ApiBillVoidBody {
	void_reason: string;
}

export interface ApiBillListParams {
	limit?: number;
	cursor?: string;
	status?: ApiBillStatus;
}

export type ApiTaskPriority = 'p1' | 'p2' | 'p3' | 'p4';
export type ApiTaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type ApiTaskSource = 'manual' | 'meeting' | 'email' | 'workflow' | 'agent';
export type ApiTaskEntityType = 'contact' | 'client' | 'lead';

export interface ApiTask {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	title: string;
	description: string | null;
	priority: ApiTaskPriority;
	status: ApiTaskStatus;
	assignee_membership_id: string | null;
	assignee_agent_id: string | null;
	due_at: string | null;
	started_at: string | null;
	completed_at: string | null;
	blocked_reason: string | null;
	source: ApiTaskSource;
	entity_type: ApiTaskEntityType | null;
	entity_id: string | null;
	meeting_id: string | null;
	project_card_id: string | null;
	position: number;
	metadata: Record<string, unknown>;
}

export interface ApiTaskListParams {
	limit?: number;
	cursor?: string;
	status?: ApiTaskStatus;
	assignee?: 'me';
}

export interface ApiTaskCreateBody {
	title: string;
	description?: string | null;
	priority?: ApiTaskPriority;
	status?: ApiTaskStatus;
	assignee_membership_id?: string | null;
	due_at?: string | null;
	entity_type?: ApiTaskEntityType | null;
	entity_id?: string | null;
	source?: ApiTaskSource;
	position?: number;
}

export type ApiTaskUpdateBody = Partial<ApiTaskCreateBody>;

export type ApiClientStatus = 'prospect' | 'active' | 'on_hold' | 'inactive' | 'archived';

export interface ApiClient {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	name: string;
	status: ApiClientStatus;
	website_url: string | null;
	industry: string | null;
	primary_email: string | null;
	phone: string | null;
	tax_identifier: string | null;
	registration_number: string | null;
	default_currency: string | null;
	payment_terms_days: number | null;
	owner_membership_id: string | null;
	converted_from_lead_id: string | null;
	renewal_on: string | null;
	notes: string | null;
	metadata: Record<string, unknown>;
}

export interface ApiClientListParams {
	limit?: number;
	cursor?: string;
}

export interface ApiClientCreateBody {
	name: string;
	status?: ApiClientStatus;
	website_url?: string | null;
	industry?: string | null;
	primary_email?: string | null;
	phone?: string | null;
	tax_identifier?: string | null;
	registration_number?: string | null;
	default_currency?: string | null;
	payment_terms_days?: number | null;
	owner_membership_id?: string | null;
	renewal_on?: string | null;
	notes?: string | null;
	metadata?: Record<string, unknown>;
}

export type ApiClientUpdateBody = Partial<ApiClientCreateBody>;

export type ApiLeadStage = 'new' | 'qualified' | 'proposal' | 'won' | 'lost';
export type ApiLeadWritableStage = 'new' | 'qualified' | 'proposal' | 'lost';

export interface ApiLead {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	name: string;
	company_name: string | null;
	contact_id: string | null;
	client_id: string | null;
	stage: ApiLeadStage;
	value_cents: number | null;
	currency: string;
	probability_percent: number | null;
	source: string | null;
	owner_membership_id: string | null;
	expected_close_on: string | null;
	lost_reason: string | null;
	won_at: string | null;
	lost_at: string | null;
	converted_at: string | null;
	position: number;
	notes: string | null;
	metadata: Record<string, unknown>;
}

export interface ApiLeadCreateBody {
	name: string;
	company_name?: string | null;
	contact_id?: string | null;
	client_id?: string | null;
	stage?: ApiLeadWritableStage;
	value_cents?: number | null;
	currency?: string;
	probability_percent?: number | null;
	source?: string | null;
	owner_membership_id?: string | null;
	expected_close_on?: string | null;
	lost_reason?: string | null;
	position?: number;
	notes?: string | null;
	metadata?: Record<string, unknown>;
}

export type ApiLeadUpdateBody = Partial<ApiLeadCreateBody>;

export interface ApiLeadListParams {
	limit?: number;
	cursor?: string;
	stage?: ApiLeadStage;
}

export interface ApiLeadConvertBody {
	client_name?: string;
	client_status?: ApiClientStatus;
}

export interface ApiLeadConvertResult {
	lead: ApiLead;
	client: ApiClient;
	idempotent: boolean;
}

export type ApiContactLifecycleStatus = 'active' | 'inactive' | 'archived';

export interface ApiContact {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	first_name: string | null;
	last_name: string | null;
	display_name: string;
	primary_email: string | null;
	primary_phone: string | null;
	job_title: string | null;
	company_name: string | null;
	/** Resolved primary client via `client_contacts` (read model). */
	client_id: string | null;
	owner_membership_id: string | null;
	lifecycle_status: ApiContactLifecycleStatus;
	source: string | null;
	notes: string | null;
	last_contacted_at: string | null;
	metadata: Record<string, unknown>;
}

export interface ApiContactCreateBody {
	display_name: string;
	first_name?: string | null;
	last_name?: string | null;
	primary_email?: string | null;
	primary_phone?: string | null;
	job_title?: string | null;
	company_name?: string | null;
	/** Primary client link via `client_contacts` (server-maintained relation). */
	client_id?: string | null;
	owner_membership_id?: string | null;
	lifecycle_status?: ApiContactLifecycleStatus;
	source?: string | null;
	notes?: string | null;
	metadata?: Record<string, unknown>;
}

export type ApiContactUpdateBody = Partial<ApiContactCreateBody>;

export interface ApiContactListParams {
	limit?: number;
	cursor?: string;
	lifecycle_status?: ApiContactLifecycleStatus;
}

export interface ApiTaxRateListParams {
	limit?: number;
}

/** Entity types that can host a document workspace. */
export type ApiDocumentEntityType =
	| 'client'
	| 'contact'
	| 'lead'
	| 'organisation'
	| 'meeting';

export type ApiDocumentCategory =
	| 'contract'
	| 'proposal'
	| 'invoice'
	| 'receipt'
	| 'transcript'
	| 'recording'
	| 'other';

export type ApiDocumentStatus = 'pending_upload' | 'ready' | 'orphan' | 'failed';

export type ApiDocumentScanStatus = 'pending' | 'clean' | 'infected' | 'failed';

export interface ApiDocumentFolder {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	entity_type: ApiDocumentEntityType;
	entity_id: string;
	parent_id: string | null;
	name: string;
}

export interface ApiDocument {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	name: string;
	category: ApiDocumentCategory;
	notes: string | null;
	bucket: string;
	storage_path: string;
	storage_version: string | null;
	mime_type: string;
	size_bytes: number;
	sha256: string;
	uploaded_by: string | null;
	uploaded_at: string | null;
	scan_status: ApiDocumentScanStatus;
	metadata: Record<string, unknown>;
	status: ApiDocumentStatus;
	upload_expires_at: string | null;
}

export interface ApiDocumentLink {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	document_id: string;
	entity_type: ApiDocumentEntityType;
	entity_id: string;
	folder_id: string | null;
}

export interface ApiDocumentBrowseItem {
	document: ApiDocument;
	link: ApiDocumentLink;
}

export interface ApiDocumentBrowseResult {
	folders: ApiDocumentFolder[];
	documents: ApiDocumentBrowseItem[];
}

export interface ApiDocumentBrowseParams {
	folder_id?: string | null;
}

export interface ApiDocumentFolderCreateBody {
	name: string;
	parent_id?: string | null;
}

export interface ApiDocumentFolderResult {
	folder: ApiDocumentFolder;
}

export interface ApiDocumentFolderPatchBody {
	name?: string;
	parent_id?: string | null;
}

export interface ApiDocumentUploadIntentBody {
	name: string;
	category: ApiDocumentCategory;
	mime_type: string;
	size_bytes: number;
	sha256: string;
	folder_id?: string | null;
}

export interface ApiDocumentSignedUpload {
	signed_url: string;
	token: string;
	path: string;
	expires_in: number;
}

export interface ApiDocumentUploadIntentResult {
	document: ApiDocument;
	link: ApiDocumentLink;
	upload: ApiDocumentSignedUpload;
}

export interface ApiDocumentFinalizeBody {
	expected_size_bytes?: number | null;
	expected_sha256?: string | null;
}

export interface ApiDocumentResult {
	document: ApiDocument;
}

export interface ApiDocumentLinkResult {
	link: ApiDocumentLink;
}

export interface ApiDocumentDownloadResult {
	document_id: string;
	signed_url: string;
	expires_in: number;
	mime_type: string;
	name: string;
}

export interface ApiDocumentRenameBody {
	name: string;
}

export interface ApiDocumentMoveBody {
	entity_type: ApiDocumentEntityType;
	entity_id: string;
	folder_id?: string | null;
}

/** Personal IMAP/SMTP mailbox for the current membership — secrets never returned. */
export interface ApiMailboxAccount {
	id: string;
	email_address: string;
	username: string;
	from_name: string | null;
	imap_host: string;
	imap_port: number;
	imap_security: 'tls' | 'starttls' | 'none';
	smtp_host: string;
	smtp_port: number;
	smtp_security: 'tls' | 'starttls' | 'none';
	credentials_configured: boolean;
	status: 'disconnected' | 'configured' | 'ok' | 'error' | 'auth_failed';
	last_checked_at: string | null;
	last_error_code: string | null;
}

export interface ApiMailboxPutBody {
	email_address: string;
	username: string;
	/** Omit or empty to keep the existing secret. */
	password?: string;
	from_name?: string | null;
	imap_host: string;
	imap_port: number;
	imap_security: 'tls' | 'starttls' | 'none';
	smtp_host: string;
	smtp_port: number;
	smtp_security: 'tls' | 'starttls' | 'none';
}

export interface ApiMailboxTestResult {
	ok: boolean;
	error_code?: string | null;
	message?: string | null;
}

export type ApiAiProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';

export interface ApiAiIntegration {
	provider: ApiAiProvider;
	credentials_configured: boolean;
	/** Wire status from `integrations.status` — FE maps `active` → connected. */
	status: 'disconnected' | 'connected' | 'pending' | 'active' | 'error' | 'disabled' | string;
	last_verified_at?: string | null;
	last_error_code: string | null;
}

export interface ApiAiIntegrationConnectBody {
	api_key: string;
}

export type ApiEntityEmailType = 'contact' | 'lead' | 'client';

export interface ApiEmailMessage {
	id: string;
	direction: 'inbound' | 'outbound';
	from_address: string;
	from_name?: string | null;
	to_addresses?: string[] | unknown;
	subject: string;
	preview_text?: string | null;
	body_text?: string | null;
	received_at?: string | null;
	sent_at?: string | null;
	link_reason?: 'address_match' | 'timeline_share' | null;
	unread?: boolean;
	/** Present on personal inbox rows from `list_my_email_messages`. */
	status?: string | null;
	is_owner?: boolean;
	mailbox_account_id?: string | null;
}

export type ApiEmailTemplateCategory =
	| 'transactional'
	| 'campaign'
	| 'chase'
	| 'onboarding'
	| 'other';

export type ApiEmailTemplateStatus = 'draft' | 'active' | 'archived';

export interface ApiEmailTemplate {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	name: string;
	subject: string;
	body_text: string | null;
	body_html: string | null;
	category: ApiEmailTemplateCategory;
	status: ApiEmailTemplateStatus;
	merge_schema: unknown[];
}

export interface ApiEmailTemplateCreateBody {
	name: string;
	subject: string;
	body_text?: string | null;
	body_html?: string | null;
	category: ApiEmailTemplateCategory;
	status?: ApiEmailTemplateStatus;
	merge_schema?: unknown[];
}

export type ApiEmailTemplateUpdateBody = Partial<ApiEmailTemplateCreateBody>;

export interface ApiEmailTemplateListParams {
	limit?: number;
	status?: ApiEmailTemplateStatus;
	category?: ApiEmailTemplateCategory;
}

export interface ApiMyEmailMessageListParams {
	limit?: number;
}

/** Body for `POST /api/v1/email-messages/{id}/share` (Wave B BE contract). */
export interface ApiEmailMessageShareBody {
	entity_type: ApiEntityEmailType;
	entity_id: string;
}

export interface ApiEmailMessageShareResult {
	message_id: string;
	link_reason: 'timeline_share';
	timeline_event_id?: string | null;
	body_text?: string | null;
	subject?: string | null;
}

export interface ApiAiSuggestionGenerateBody {
	email_message_id: string;
	/** BE field name — warm | neutral | firm. */
	variant?: 'warm' | 'neutral' | 'firm' | string;
}

export interface ApiAiSuggestion {
	id: string;
	status: 'generating' | 'ready' | 'used' | 'discarded' | string;
	/** BE returns `output_text`; keep optional alias for older fixtures. */
	output_text?: string;
	suggestion_text?: string;
	variant?: string | null;
	kind?: string;
}

export type ApiRecurringInvoiceStatus =
	| 'draft'
	| 'active'
	| 'paused'
	| 'completed'
	| 'cancelled';

export type ApiRecurringInvoiceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type ApiRecurringInvoiceMonthEndPolicy = 'clamp' | 'last_day' | 'skip';

export type ApiRecurringInvoiceDeliveryMode = 'draft' | 'auto_send';

export type ApiRecurringInvoicePricingMode = 'fixed' | 'catalog_at_generation';

export type ApiRecurringInvoiceCatchUpPolicy = 'skip' | 'latest' | 'all';

export type ApiRecurringInvoiceRunStatus =
	| 'pending'
	| 'processing'
	| 'generated'
	| 'delivery_pending'
	| 'sent'
	| 'skipped'
	| 'generation_failed'
	| 'delivery_failed'
	| 'delivery_unknown';

export type ApiRecurringInvoiceRunTrigger = 'scheduled' | 'manual' | 'catch_up';

export interface ApiRecurringInvoiceSchedule {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	deleted_at: string | null;
	version: number;
	name: string;
	client_id: string;
	contact_id: string | null;
	owner_membership_id: string | null;
	status: ApiRecurringInvoiceStatus;
	currency: string;
	frequency: ApiRecurringInvoiceFrequency;
	interval_count: number;
	anchor_on: string;
	rule_version: number;
	weekdays: number[] | null;
	day_of_month: number | null;
	month_of_year: number | null;
	month_end_policy: ApiRecurringInvoiceMonthEndPolicy;
	timezone: string;
	local_run_time: string;
	start_on: string;
	end_on: string | null;
	max_occurrences: number | null;
	scheduled_occurrence_count: number;
	next_run_at: string | null;
	last_run_at: string | null;
	due_days: number;
	delivery_mode: ApiRecurringInvoiceDeliveryMode;
	pricing_mode: ApiRecurringInvoicePricingMode;
	catch_up_policy: ApiRecurringInvoiceCatchUpPolicy;
	max_catch_up_runs: number;
	purchase_order_number: string | null;
	payment_terms: string | null;
	notes: string | null;
	internal_notes: string | null;
	activated_at: string | null;
	paused_at: string | null;
	completed_at: string | null;
	cancelled_at: string | null;
	cancelled_by: string | null;
	/** Optional projection fields from GET/detail responses. */
	next_issue_on?: string | null;
	next_due_on?: string | null;
	estimated_total_cents?: number | null;
	client_name?: string | null;
}

export interface ApiRecurringInvoiceLine {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	version: number;
	schedule_id: string;
	product_id: string | null;
	sku_snapshot: string | null;
	description_template: string;
	quantity: number;
	unit_price_cents: number;
	discount_percent: number;
	tax_rate_percent: number;
	position: number;
	active: boolean;
}

export type ApiRecurringInvoiceDocument = ApiRecurringInvoiceSchedule & {
	lines: ApiRecurringInvoiceLine[];
};

export interface ApiRecurringInvoiceLineInput {
	product_id?: string | null;
	description_template: string;
	quantity: number | string;
	unit_price_cents: number;
	discount_percent?: number | string;
	tax_rate_percent?: number | string;
	position?: number;
}

interface ApiRecurringInvoiceWritableFields {
	name?: string;
	client_id?: string;
	contact_id?: string | null;
	currency?: string;
	frequency?: ApiRecurringInvoiceFrequency;
	interval_count?: number;
	anchor_on?: string;
	weekdays?: number[] | null;
	day_of_month?: number | null;
	month_of_year?: number | null;
	month_end_policy?: ApiRecurringInvoiceMonthEndPolicy;
	timezone?: string;
	local_run_time?: string;
	start_on?: string;
	end_on?: string | null;
	max_occurrences?: number | null;
	due_days?: number;
	delivery_mode?: ApiRecurringInvoiceDeliveryMode;
	pricing_mode?: ApiRecurringInvoicePricingMode;
	catch_up_policy?: ApiRecurringInvoiceCatchUpPolicy;
	max_catch_up_runs?: number;
	purchase_order_number?: string | null;
	payment_terms?: string | null;
	notes?: string | null;
	internal_notes?: string | null;
}

export type ApiRecurringInvoiceCreateBody = ApiRecurringInvoiceWritableFields & {
	name: string;
	client_id: string;
	currency: string;
	frequency: ApiRecurringInvoiceFrequency;
	interval_count: number;
	anchor_on: string;
	month_end_policy: ApiRecurringInvoiceMonthEndPolicy;
	timezone: string;
	local_run_time: string;
	start_on: string;
	due_days: number;
	delivery_mode: ApiRecurringInvoiceDeliveryMode;
	pricing_mode: ApiRecurringInvoicePricingMode;
	catch_up_policy: ApiRecurringInvoiceCatchUpPolicy;
	max_catch_up_runs: number;
	lines: ApiRecurringInvoiceLineInput[];
};

export type ApiRecurringInvoiceUpdateBody = ApiRecurringInvoiceWritableFields & {
	lines?: ApiRecurringInvoiceLineInput[];
};

export type ApiRecurringInvoicePreviewBody = ApiRecurringInvoiceCreateBody;

export interface ApiRecurringInvoicePreviewResult {
	next_run_at?: string | null;
	next_issue_on?: string | null;
	next_due_on?: string | null;
	projected_dates?: string[];
	estimated_total_cents?: number | null;
	currency?: string;
}

export interface ApiRecurringInvoiceRun {
	id: string;
	org_id: string;
	schedule_id: string;
	occurrence_sequence: number | null;
	occurrence_key: string;
	scheduled_for: string;
	occurrence_local_date: string;
	occurrence_timezone: string;
	schedule_version: number;
	period_start: string;
	period_end: string;
	trigger: ApiRecurringInvoiceRunTrigger;
	status: ApiRecurringInvoiceRunStatus;
	attempt_count: number;
	available_at: string;
	generated_at: string | null;
	sent_at: string | null;
	error_code: string | null;
	error_message: string | null;
	invoice_id?: string | null;
	invoice_number?: string | null;
	created_at: string;
	updated_at: string;
}

export type ApiRecurringInvoiceRunDocument = ApiRecurringInvoiceRun & {
	invoice_id?: string | null;
	invoice_number?: string | null;
};

/** `POST .../run-now` body — invoice is linked via `invoices.recurring_run_id`, not on the run row. */
export interface ApiRecurringInvoiceRunNowResult {
	run: ApiRecurringInvoiceRun;
	invoice: ApiInvoice;
	lines?: ApiInvoiceLine[];
	schedule: ApiRecurringInvoiceSchedule;
}

export interface ApiRecurringInvoiceListParams {
	limit?: number;
	cursor?: string;
	status?: ApiRecurringInvoiceStatus;
}

export interface ApiRecurringInvoiceRunListParams {
	limit?: number;
	cursor?: string;
}

// --- Payments ---

export type ApiPaymentDirection = 'inbound' | 'outbound';
export type ApiPaymentMethod = 'bank' | 'card' | 'cash' | 'stripe' | 'other';
export type ApiPaymentStatus =
	| 'pending'
	| 'completed'
	| 'unallocated'
	| 'part_allocated'
	| 'allocated'
	| 'refunded'
	| 'reversed'
	| 'failed';

export interface ApiPayment {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	version: number;
	direction: ApiPaymentDirection;
	client_id: string | null;
	vendor_id: string | null;
	amount_cents: number;
	currency: string;
	method: ApiPaymentMethod;
	status: ApiPaymentStatus;
	occurred_on: string;
	reference: string | null;
	provider: string | null;
	provider_payment_id: string | null;
	notes: string | null;
	reverses_payment_id: string | null;
	completed_at: string | null;
	metadata: unknown;
	/** Present when list/get joins active allocation totals. */
	allocated_cents?: number;
}

export interface ApiPaymentAllocation {
	id: string;
	org_id: string;
	created_at: string;
	updated_at: string;
	created_by: string | null;
	updated_by: string | null;
	version: number;
	payment_id: string;
	invoice_id: string | null;
	bill_id: string | null;
	amount_cents: number;
	allocated_at: string;
	reversed_at: string | null;
	reversal_reason: string | null;
	/** Optional join labels when BE includes them. */
	invoice_number?: string | null;
	bill_number?: string | null;
}

export type ApiPaymentDocument = ApiPayment & {
	allocations: ApiPaymentAllocation[];
	/** Present on reverse responses when BE returns the reversing ledger row. */
	reversing_payment?: ApiPayment;
};

export interface ApiPaymentAllocationInput {
	invoice_id?: string;
	bill_id?: string;
	amount_cents: number;
}

export interface ApiPaymentCreateBody {
	direction: ApiPaymentDirection;
	client_id?: string | null;
	vendor_id?: string | null;
	amount_cents: number;
	currency: string;
	method: ApiPaymentMethod;
	occurred_on: string;
	reference?: string | null;
	provider?: string | null;
	provider_payment_id?: string | null;
	notes?: string | null;
	allocations?: ApiPaymentAllocationInput[];
}

export interface ApiPaymentAllocateBody {
	allocations: ApiPaymentAllocationInput[];
}

export interface ApiPaymentReverseBody {
	reason: string;
}

export interface ApiPaymentListParams {
	limit?: number;
	cursor?: string;
	direction?: ApiPaymentDirection;
	client_id?: string;
	vendor_id?: string;
	status?: ApiPaymentStatus;
	/** Via payment_allocations join — mutually exclusive with bill_id. */
	invoice_id?: string;
	/** Via payment_allocations join — mutually exclusive with invoice_id. */
	bill_id?: string;
}
