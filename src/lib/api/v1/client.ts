import { ApiClientError, type ApiErrorCode } from './errors.js';
import type {
	ApiEnvelope,
	ApiErrorBody,
	ApiOrganisationConfiguration,
	ApiOrganisationConfigurationPatch,
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrganisationMembership,
	ApiProfilePreferences,
	ApiProfilePreferencesPatch,
	ApiTaxRate,
	ApiTaxRateCreateBody,
	ApiTaxRatePatchBody
} from './types.js';

export interface ApiV1ClientOptions {
	/** API origin or absolute prefix. Defaults to empty (same-origin `/api/v1/...`). */
	baseUrl?: string;
	fetch?: typeof fetch;
	getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
	/** Selected organisation for org-scoped routes. */
	getOrgId?: () => string | null | undefined;
	/** Optional request-id factory (defaults to crypto.randomUUID when available). */
	createRequestId?: () => string;
}

export interface ApiRequestOptions {
	method?: string;
	body?: unknown;
	/** When true (default for org helpers), requires and sends `X-Org-Id`. */
	orgScoped?: boolean;
	/** Optimistic concurrency token → `If-Match: "<version>"`. */
	ifMatchVersion?: number;
	headers?: HeadersInit;
	signal?: AbortSignal;
}

export interface ApiV1Client {
	request<T>(path: string, options?: ApiRequestOptions): Promise<{ data: T; etag: string | null; status: number }>;
	listOrganisations(): Promise<ApiOrganisationMembership[]>;
	createOrganisation(body: ApiOrganisationCreateBody): Promise<ApiOrganisationCreateResult>;
	getOrganisationConfiguration(): Promise<ApiOrganisationConfiguration>;
	patchOrganisationConfiguration(
		body: ApiOrganisationConfigurationPatch,
		version: number
	): Promise<ApiOrganisationConfiguration>;
	listTaxRates(limit?: number): Promise<ApiTaxRate[]>;
	createTaxRate(body: ApiTaxRateCreateBody): Promise<ApiTaxRate>;
	patchTaxRate(id: string, body: ApiTaxRatePatchBody, version: number): Promise<ApiTaxRate>;
	deleteTaxRate(id: string, version: number): Promise<void>;
	getProfilePreferences(): Promise<ApiProfilePreferences>;
	patchProfilePreferences(body: ApiProfilePreferencesPatch): Promise<ApiProfilePreferences>;
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
	const baseUrl = normalizeBaseUrl(options.baseUrl);
	const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
	const createRequestId =
		options.createRequestId ??
		(() =>
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `req-${Date.now()}`);

	async function request<T>(
		path: string,
		requestOptions: ApiRequestOptions = {}
	): Promise<{ data: T; etag: string | null; status: number }> {
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

		let response: Response;
		try {
			response = await fetchImpl(resolvePath(baseUrl, path), {
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

		const data = (payload as ApiEnvelope<T> | null)?.data;
		if (data === undefined) {
			throw new ApiClientError({
				status: response.status,
				code: 'INTERNAL_ERROR',
				message: 'Response envelope was missing data',
				requestId
			});
		}

		return { data, etag, status: response.status };
	}

	return {
		request,
		listOrganisations: async () => {
			const { data } = await request<ApiOrganisationMembership[]>('/api/v1/organisations', {
				orgScoped: false
			});
			return data;
		},
		createOrganisation: async (body) => {
			const { data } = await request<ApiOrganisationCreateResult>('/api/v1/organisations', {
				method: 'POST',
				body,
				orgScoped: false
			});
			return data;
		},
		getOrganisationConfiguration: async () => {
			const { data } = await request<ApiOrganisationConfiguration>(
				'/api/v1/organisation/configuration',
				{ orgScoped: true }
			);
			return data;
		},
		patchOrganisationConfiguration: async (body, version) => {
			const { data } = await request<ApiOrganisationConfiguration>(
				'/api/v1/organisation/configuration',
				{
					method: 'PATCH',
					body,
					orgScoped: true,
					ifMatchVersion: version
				}
			);
			return data;
		},
		listTaxRates: async (limit = 50) => {
			const { data } = await request<ApiTaxRate[]>(`/api/v1/tax-rates?limit=${limit}`, {
				orgScoped: true
			});
			return data;
		},
		createTaxRate: async (body) => {
			const { data } = await request<ApiTaxRate>('/api/v1/tax-rates', {
				method: 'POST',
				body,
				orgScoped: true
			});
			return data;
		},
		patchTaxRate: async (id, body, version) => {
			const { data } = await request<ApiTaxRate>(`/api/v1/tax-rates/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version
			});
			return data;
		},
		deleteTaxRate: async (id, version) => {
			await request<undefined>(`/api/v1/tax-rates/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version
			});
		},
		getProfilePreferences: async () => {
			const { data } = await request<ApiProfilePreferences>('/api/v1/profile/preferences', {
				orgScoped: false
			});
			return data;
		},
		patchProfilePreferences: async (body) => {
			const { data } = await request<ApiProfilePreferences>('/api/v1/profile/preferences', {
				method: 'PATCH',
				body,
				orgScoped: false
			});
			return data;
		}
	};
}
