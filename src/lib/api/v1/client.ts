import { ApiClientError, type ApiErrorCode } from './errors.js';
import { createOrganisationConfigEndpoints } from './endpoints/organisation-config.js';
import { createOrganisationsEndpoints } from './endpoints/organisations.js';
import { createProfilePreferencesEndpoints } from './endpoints/profile-preferences.js';
import { createQuotesEndpoints } from './endpoints/quotes.js';
import { createTaxRatesEndpoints } from './endpoints/tax-rates.js';
import type {
	OrganisationConfigEndpoints,
	OrganisationsEndpoints,
	ProfilePreferencesEndpoints,
	QuotesEndpoints,
	TaxRatesEndpoints
} from './endpoints/types.js';
import type { ApiRequestFn, ApiRequestOptions, ApiResult } from './request.js';
import type { ApiEnvelope, ApiErrorBody } from './types.js';

export type { ApiRequestFn, ApiRequestOptions, ApiResult } from './request.js';

export interface ApiV1ClientOptions {
	/**
	 * API origin or absolute prefix. Defaults to `PUBLIC_API_BASE_URL` (Vite/SvelteKit
	 * public env) when set, otherwise empty (same-origin `/api/v1/...` paths).
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
	quotes: QuotesEndpoints;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
	if (!baseUrl) return '';
	return baseUrl.replace(/\/+$/, '');
}

function defaultBaseUrl(): string {
	// Public Vite/SvelteKit env — inlined at build for SSR + client. Prefer this over
	// `$env/dynamic/public`, which Storybook/vitest browser harnesses do not always provide.
	const fromEnv = (import.meta.env.PUBLIC_API_BASE_URL as string | undefined)?.trim();
	return normalizeBaseUrl(fromEnv || undefined);
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
	const known: ApiErrorCode[] = [
		'BAD_REQUEST',
		'CONFLICT',
		'FORBIDDEN',
		'INTERNAL_ERROR',
		'METHOD_NOT_ALLOWED',
		'NETWORK_ERROR',
		'NOT_FOUND',
		'ORG_CONTEXT_REQUIRED',
		'PAYLOAD_TOO_LARGE',
		'PRECONDITION_FAILED',
		'PRECONDITION_REQUIRED',
		'UNAUTHENTICATED',
		'UNSUPPORTED_MEDIA_TYPE',
		'VALIDATION_ERROR',
		'UNKNOWN'
	];
	return known.includes(value as ApiErrorCode) ? (value as ApiErrorCode) : 'UNKNOWN';
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
	const baseUrl = normalizeBaseUrl(
		options.baseUrl !== undefined ? options.baseUrl : defaultBaseUrl()
	);
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
		const headers = new Headers(requestOptions.headers);
		headers.set('Accept', 'application/json');
		if (!headers.has('x-request-id')) {
			headers.set('x-request-id', createRequestId());
		}

		const token = await options.getAccessToken?.();
		if (token) {
			headers.set('Authorization', `Bearer ${token}`);
		}

		if (orgScoped) {
			const orgId = options.getOrgId?.();
			if (!orgId) {
				throw new ApiClientError({
					status: 400,
					code: 'ORG_CONTEXT_REQUIRED',
					message: 'X-Org-Id is required for organisation-scoped routes'
				});
			}
			headers.set('X-Org-Id', orgId);
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
		quotes: createQuotesEndpoints(request)
	};
}
