/**
 * Resolve the server-side upstream for same-origin `/api/v1/*` proxying.
 * Prefers explicit `API_V1_UPSTREAM`, else `${PUBLIC_SUPABASE_URL}/functions/v1/api-v1`.
 */
export function resolveApiV1Upstream(options: {
	apiV1Upstream?: string | null;
	publicSupabaseUrl?: string | null;
	fallback?: string;
}): string | null {
	const explicit = options.apiV1Upstream?.trim();
	if (explicit) return explicit.replace(/\/+$/, '');

	const supabase = options.publicSupabaseUrl?.trim();
	if (supabase) {
		return `${supabase.replace(/\/+$/, '')}/functions/v1/api-v1`;
	}

	const fallback = options.fallback?.trim();
	return fallback ? fallback.replace(/\/+$/, '') : null;
}

/**
 * Browser path `/api/v1/organisations` → edge `/functions/v1/api-v1/organisations`
 * (apiPath on the edge accepts this; avoids `api-v1/api/v1` in the browser).
 */
export function buildApiV1ProxyUrl(
	upstreamBase: string,
	pathname: string,
	search = ''
): string {
	const base = upstreamBase.replace(/\/+$/, '');
	const normalized = pathname.replace(/\/+$/, '') || '/';
	const suffix = normalized.startsWith('/api/v1')
		? normalized.slice('/api/v1'.length) || '/'
		: normalized;
	const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
	return `${base}${path}${search}`;
}

/**
 * Explicit allow-list of headers forwarded upstream. Everything else (cookies,
 * hop-by-hop headers, spoofable x-forwarded-* / x-real-ip, etc.) is dropped.
 * Mirrors the headers the edge function accepts via CORS.
 */
const FORWARD_REQUEST_HEADERS = new Set([
	'accept',
	'accept-language',
	'apikey',
	'authorization',
	'content-type',
	'idempotency-key',
	'if-match',
	'x-client-info',
	'x-org-id',
	'x-request-id'
]);

export function forwardProxyHeaders(source: Headers): Headers {
	const headers = new Headers();
	for (const [key, value] of source.entries()) {
		if (!FORWARD_REQUEST_HEADERS.has(key.toLowerCase())) continue;
		headers.set(key, value);
	}
	return headers;
}
