import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import {
	buildApiV1ProxyUrl,
	forwardProxyHeaders,
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

	const pathSuffix = event.params.path ? `/${event.params.path}` : '';
	const pathname = `/api/v1${pathSuffix}`;
	const target = buildApiV1ProxyUrl(upstream, pathname, event.url.search);
	const headers = forwardProxyHeaders(event.request.headers);

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
		const responseHeaders = new Headers(upstreamResponse.headers);
		responseHeaders.delete('content-encoding');
		responseHeaders.delete('transfer-encoding');
		return new Response(upstreamResponse.body, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers: responseHeaders
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Upstream request failed';
		return new Response(
			JSON.stringify({
				error: {
					code: 'NETWORK_ERROR',
					message
				}
			}),
			{ status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } }
		);
	}
}

export const GET: RequestHandler = proxy;
export const POST: RequestHandler = proxy;
export const PUT: RequestHandler = proxy;
export const PATCH: RequestHandler = proxy;
export const DELETE: RequestHandler = proxy;
export const OPTIONS: RequestHandler = proxy;
