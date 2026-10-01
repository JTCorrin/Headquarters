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

function isSafeProxySegment(segment: string): boolean {
	let decoded: string;
	try {
		decoded = decodeURIComponent(segment);
	} catch {
		return false;
	}
	return decoded !== '.' && decoded !== '..' && !/[/\\?#]/.test(decoded);
}

/**
 * Browser path `/api/v1/organisations` → edge `/functions/v1/api-v1/organisations`
 * (apiPath on the edge accepts this; avoids `api-v1/api/v1` in the browser).
 *
 * `pathname` must be the raw (still percent-encoded) request path. Returns null
 * when a segment could escape the upstream base (dot segments, encoded `/`, `\`,
 * `?`, `#`), so callers can reject the request instead of proxying elsewhere.
 */
export function buildApiV1ProxyUrl(
	upstreamBase: string,
	pathname: string,
	search = ''
): string | null {
	const base = upstreamBase.replace(/\/+$/, '');
	const normalized = pathname.replace(/\/+$/, '') || '/';
	const suffix = normalized.startsWith('/api/v1')
		? normalized.slice('/api/v1'.length) || '/'
		: normalized;
	const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
	if (!path.split('/').filter(Boolean).every(isSafeProxySegment)) return null;

	const target = `${base}${path}${search}`;
	try {
		const basePath = new URL(base).pathname.replace(/\/+$/, '');
		const resolved = new URL(target);
		if (resolved.origin !== new URL(base).origin) return null;
		if (resolved.pathname !== basePath && !resolved.pathname.startsWith(`${basePath}/`)) {
			return null;
		}
	} catch {
		return null;
	}
	return target;
}

/** Upstream response headers that must not be relayed to the browser. */
const STRIP_RESPONSE_HEADERS = [
	'connection',
	'content-encoding',
	'content-length',
	'keep-alive',
	'proxy-authenticate',
	'set-cookie',
	'trailer',
	'transfer-encoding',
	'upgrade'
];

export function forwardProxyResponseHeaders(source: Headers): Headers {
	const headers = new Headers(source);
	for (const name of STRIP_RESPONSE_HEADERS) headers.delete(name);
	return headers;
}

/**
 * Explicit allow-list of headers forwarded upstream. Everything else (cookies,
 * hop-by-hop headers, spoofable x-forwarded-* / x-real-ip, etc.) is dropped.
 * Mirrors the headers the edge function accepts via CORS.
 * Also forwards `mcp-*` (Cursor / MCP session headers).
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

export interface ForwardProxyHeadersOptions {
	/**
	 * When the inbound request has no `apikey`, inject this value (typically
	 * `PUBLIC_SUPABASE_ANON_KEY`). Kong requires it; agents should only paste
	 * the CRM `crm_key_…` Bearer secret.
	 */
	fallbackApikey?: string | null;
}

export function forwardProxyHeaders(
	source: Headers,
	options: ForwardProxyHeadersOptions = {}
): Headers {
	const headers = new Headers();
	for (const [key, value] of source.entries()) {
		const lower = key.toLowerCase();
		if (!FORWARD_REQUEST_HEADERS.has(lower) && !lower.startsWith('mcp-')) continue;
		headers.set(key, value);
	}
	if (!headers.has('apikey')) {
		const anon = options.fallbackApikey?.trim();
		if (anon) headers.set('apikey', anon);
	}
	return headers;
}
