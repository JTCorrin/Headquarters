import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import {
	buildApiV1ProxyUrl,
	forwardProxyHeaders,
	forwardProxyResponseHeaders,
	resolveApiV1Upstream
} from '$lib/auth/proxy.js';
import type { RequestHandler } from './$types.js';

async function proxy(event: Parameters<RequestHandler>[0]): Promise<Response> {
	const upstream = resolveApiV1Upstream({
		apiV1Upstream: privateEnv.API_V1_UPSTREAM,
		publicSupabaseUrl: publicEnv.PUBLIC_SUPABASE_URL,
		fallback: 'http://127.0.0.1:54321/functions/v1/api-v1'
	});

	if (!upstream) {
		return new Response(
			JSON.stringify({
				error: {
					code: 'INTERNAL_ERROR',
					message: 'API proxy upstream is not configured'
				}
			}),
			{ status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } }
		);
	}

	// Raw pathname, not `event.params.path`: params are percent-decoded, so `..%2F`
	// would become a real dot segment and escape the upstream base.
	const pathname = event.url.pathname;
	const target = buildApiV1ProxyUrl(upstream, pathname, event.url.search);
	if (!target) {
		return new Response(
			JSON.stringify({
				error: { code: 'VALIDATION_ERROR', message: 'Invalid API path' }
			}),
			{ status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } }
		);
	}
	const headers = forwardProxyHeaders(event.request.headers, {
		fallbackApikey: publicEnv.PUBLIC_SUPABASE_ANON_KEY
	});

	const init: RequestInit = {
		method: event.request.method,
		headers,
		redirect: 'manual'
	};

	if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
		init.body = await event.request.arrayBuffer();
	}

	try {
		const upstreamResponse = await event.fetch(target, init);
		// Also drops content-encoding/length: undici may decompress while leaving the
		// upstream Content-Length, which makes strict clients abort the body.
		const responseHeaders = forwardProxyResponseHeaders(upstreamResponse.headers);
		return new Response(upstreamResponse.body, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers: responseHeaders
		});
	} catch (error) {
		const requestId = event.request.headers.get('x-request-id')?.trim() || crypto.randomUUID();
		console.error('API v1 proxy upstream failure', {
			requestId,
			method: event.request.method,
			pathname,
			message: error instanceof Error ? error.message : String(error)
		});
		return new Response(
			JSON.stringify({
				error: {
					code: 'NETWORK_ERROR',
					message: 'Upstream request failed',
					request_id: requestId
				}
			}),
			{
				status: 502,
				headers: {
					'content-type': 'application/json; charset=utf-8',
					'x-request-id': requestId
				}
			}
		);
	}
}

export const GET: RequestHandler = proxy;
export const POST: RequestHandler = proxy;
export const PUT: RequestHandler = proxy;
export const PATCH: RequestHandler = proxy;
export const DELETE: RequestHandler = proxy;
export const OPTIONS: RequestHandler = proxy;
