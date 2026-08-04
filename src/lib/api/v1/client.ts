import { API_ERROR_CODES, ApiClientError, type ApiErrorCode } from './errors.js';
import { createAuditEventsEndpoints } from './endpoints/audit-events.js';
import { createRecurringInvoiceSchedulesEndpoints } from './endpoints/recurring-invoice-schedules.js';
import { createBillsEndpoints } from './endpoints/bills.js';
import { createClientsEndpoints } from './endpoints/clients.js';
import { createContactsEndpoints } from './endpoints/contacts.js';
import { createDocumentsEndpoints } from './endpoints/documents.js';
import { createEmailMessagesEndpoints } from './endpoints/email-messages.js';
import { createEmailTemplatesEndpoints } from './endpoints/email-templates.js';
import { createIntegrationsEndpoints } from './endpoints/integrations.js';
import { createInvoicesEndpoints } from './endpoints/invoices.js';
import { createLeadsEndpoints } from './endpoints/leads.js';
import { createMailboxEndpoints } from './endpoints/mailbox.js';
import { createCalendarEndpoints } from './endpoints/calendar.js';
import { createOrganisationConfigEndpoints } from './endpoints/organisation-config.js';
import { createOrganisationsEndpoints } from './endpoints/organisations.js';
import { createPaymentsEndpoints } from './endpoints/payments.js';
import { createProfilePreferencesEndpoints } from './endpoints/profile-preferences.js';
import { createProductsEndpoints } from './endpoints/products.js';
import { createQuotesEndpoints } from './endpoints/quotes.js';
import { createTaxRatesEndpoints } from './endpoints/tax-rates.js';
import { createTasksEndpoints } from './endpoints/tasks.js';
import { createMeetingsEndpoints } from './endpoints/meetings.js';
import { createProjectsEndpoints } from './endpoints/projects.js';
import { createTimelineEventsEndpoints } from './endpoints/timeline-events.js';
import { createVendorsEndpoints } from './endpoints/vendors.js';
import type {
	AuditEventsEndpoints,
	BillsEndpoints,
	ClientsEndpoints,
	ContactsEndpoints,
	DocumentsEndpoints,
	EmailMessagesEndpoints,
	EmailTemplatesEndpoints,
	IntegrationsEndpoints,
	InvoicesEndpoints,
	LeadsEndpoints,
	MailboxEndpoints,
	CalendarEndpoints,
	MeetingsEndpoints,
	OrganisationConfigEndpoints,
	OrganisationsEndpoints,
	PaymentsEndpoints,
	ProductsEndpoints,
	ProfilePreferencesEndpoints,
	ProjectsEndpoints,
	QuotesEndpoints,
	RecurringInvoiceSchedulesEndpoints,
	TaxRatesEndpoints,
	TasksEndpoints,
	TimelineEventsEndpoints,
	VendorsEndpoints
} from './endpoints/types.js';
import type { ApiRequestFn, ApiRequestOptions, ApiResult } from './request.js';
import type { ApiEnvelope, ApiErrorBody } from './types.js';

export type { ApiRequestFn, ApiRequestOptions, ApiResult } from './request.js';

export interface ApiV1ClientOptions {
	/**
	 * API origin or absolute prefix. Defaults to empty (same-origin `/api/v1/...` paths).
	 * Pass `PUBLIC_API_BASE_URL` from `$env/static/public` at the SvelteKit composition root.
	 */
	baseUrl?: string;
	fetch?: typeof fetch;
	getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
	/** Selected organisation for org-scoped routes. */
	getOrgId?: () => string | null | undefined;
	/** Optional request-id factory (defaults to crypto.randomUUID when available). */
	createRequestId?: () => string;
}

export interface ApiV1Client {
	request: ApiRequestFn;
	organisations: OrganisationsEndpoints;
	organisationConfig: OrganisationConfigEndpoints;
	taxRates: TaxRatesEndpoints;
	profilePreferences: ProfilePreferencesEndpoints;
	mailbox: MailboxEndpoints;
	calendar: CalendarEndpoints;
	integrations: IntegrationsEndpoints;
	products: ProductsEndpoints;
	quotes: QuotesEndpoints;
	invoices: InvoicesEndpoints;
	recurringInvoiceSchedules: RecurringInvoiceSchedulesEndpoints;
	vendors: VendorsEndpoints;
	bills: BillsEndpoints;
	payments: PaymentsEndpoints;
	contacts: ContactsEndpoints;
	clients: ClientsEndpoints;
	leads: LeadsEndpoints;
	tasks: TasksEndpoints;
	meetings: MeetingsEndpoints;
	projects: ProjectsEndpoints;
	documents: DocumentsEndpoints;
	emailMessages: EmailMessagesEndpoints;
	emailTemplates: EmailTemplatesEndpoints;
	timelineEvents: TimelineEventsEndpoints;
	auditEvents: AuditEventsEndpoints;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
	if (!baseUrl) return '';
	return baseUrl.replace(/\/+$/, '');
}

function resolvePath(baseUrl: string, path: string): string {
	if (path.startsWith('http://') || path.startsWith('https://')) return path;
	const normalized = path.startsWith('/') ? path : `/${path}`;
	return `${baseUrl}${normalized}`;
}

function appendQuery(path: string, query: ApiRequestOptions['query']): string {
	if (!query) return path;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null) continue;
		params.set(key, String(value));
	}
	const encoded = params.toString();
	if (!encoded) return path;
	return path.includes('?') ? `${path}&${encoded}` : `${path}?${encoded}`;
}

function parseErrorCode(value: string | undefined): ApiErrorCode {
	return API_ERROR_CODES.includes(value as ApiErrorCode) ? (value as ApiErrorCode) : 'UNKNOWN';
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

export function createApiV1Client(options: ApiV1ClientOptions = {}): ApiV1Client {
	const baseUrl = normalizeBaseUrl(options.baseUrl);
	const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
	const createRequestId =
		options.createRequestId ??
		(() =>
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `req-${Date.now()}`);

	const request: ApiRequestFn = async <T>(
		path: string,
		requestOptions: ApiRequestOptions = {}
	): Promise<ApiResult<T>> => {
		const orgScoped = requestOptions.orgScoped ?? false;
		// Capture org before any await so a concurrent org switch cannot change X-Org-Id
		// after this request was initiated (token lookup may be async).
		const orgIdAtStart = orgScoped ? options.getOrgId?.() : undefined;
		if (orgScoped && !orgIdAtStart) {
			throw new ApiClientError({
				status: 400,
				code: 'ORG_CONTEXT_REQUIRED',
				message: 'X-Org-Id is required for organisation-scoped routes'
			});
		}

		const headers = new Headers(requestOptions.headers);
		headers.set('Accept', 'application/json');
		if (!headers.has('x-request-id')) {
			headers.set('x-request-id', createRequestId());
		}
		if (orgIdAtStart) {
			headers.set('X-Org-Id', orgIdAtStart);
		}

		const token = await options.getAccessToken?.();
		if (token) {
			headers.set('Authorization', `Bearer ${token}`);
		}

		if (requestOptions.ifMatchVersion !== undefined) {
			headers.set('If-Match', `"${requestOptions.ifMatchVersion}"`);
		}

		let body: string | undefined;
		if (requestOptions.body !== undefined) {
			headers.set('Content-Type', 'application/json; charset=utf-8');
			body = JSON.stringify(requestOptions.body);
		}

		const url = resolvePath(baseUrl, appendQuery(path, requestOptions.query));

		let response: Response;
		try {
			response = await fetchImpl(url, {
				method: requestOptions.method ?? 'GET',
				headers,
				body,
				signal: requestOptions.signal
			});
		} catch (error) {
			throw new ApiClientError({
				status: 0,
				code: 'NETWORK_ERROR',
				message: error instanceof Error ? error.message : 'Network request failed'
			});
		}

		const etag = response.headers.get('etag');
		const requestId = response.headers.get('x-request-id') ?? undefined;

		if (response.status === 204) {
			return { data: undefined as T, etag, status: 204 };
		}

		const payload = await readJson(response);
		if (!response.ok) {
			const err = (payload as ApiErrorBody | null)?.error;
			throw new ApiClientError({
				status: response.status,
				code: parseErrorCode(err?.code),
				message: err?.message ?? `Request failed with status ${response.status}`,
				fields: err?.fields,
				requestId: err?.request_id ?? requestId
			});
		}

		const envelope = payload as ApiEnvelope<T> | null;
		if (envelope?.data === undefined) {
			throw new ApiClientError({
				status: response.status,
				code: 'INTERNAL_ERROR',
				message: 'Response envelope was missing data',
				requestId
			});
		}

		return {
			data: envelope.data,
			meta: envelope.meta,
			etag,
			status: response.status
		};
	};

	return {
		request,
		organisations: createOrganisationsEndpoints(request),
		organisationConfig: createOrganisationConfigEndpoints(request),
		taxRates: createTaxRatesEndpoints(request),
		profilePreferences: createProfilePreferencesEndpoints(request),
		mailbox: createMailboxEndpoints(request),
		calendar: createCalendarEndpoints(request),
		integrations: createIntegrationsEndpoints(request),
		products: createProductsEndpoints(request),
		quotes: createQuotesEndpoints(request),
		invoices: createInvoicesEndpoints(request),
		recurringInvoiceSchedules: createRecurringInvoiceSchedulesEndpoints(request),
		vendors: createVendorsEndpoints(request),
		bills: createBillsEndpoints(request),
		payments: createPaymentsEndpoints(request),
		contacts: createContactsEndpoints(request),
		clients: createClientsEndpoints(request),
		leads: createLeadsEndpoints(request),
		tasks: createTasksEndpoints(request),
		meetings: createMeetingsEndpoints(request),
		projects: createProjectsEndpoints(request),
		documents: createDocumentsEndpoints(request),
		emailMessages: createEmailMessagesEndpoints(request),
		emailTemplates: createEmailTemplatesEndpoints(request),
		timelineEvents: createTimelineEventsEndpoints(request),
		auditEvents: createAuditEventsEndpoints(request)
	};
}
