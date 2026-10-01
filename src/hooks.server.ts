import type { Handle } from '@sveltejs/kit';
import { createSupabaseServerClient, getValidatedSession } from '$lib/server/auth/supabase.js';

/**
 * Conservative defaults that do not constrain scripts/styles (Svelte inline
 * styles, KaTeX, Supabase). A full script CSP would need `kit.csp` nonces.
 */
const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-frame-options': 'SAMEORIGIN',
	'content-security-policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
	'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createSupabaseServerClient(event);
	// getUser() is an Auth server round-trip; layout + page loads share one per request.
	let validated: ReturnType<typeof getValidatedSession> | undefined;
	event.locals.getValidatedSession = () =>
		(validated ??= getValidatedSession(event.locals.supabase));

	let response = await resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (response.headers.has(name)) continue;
		try {
			response.headers.set(name, value);
		} catch {
			// Responses returned straight from fetch() have immutable headers.
			response = new Response(response.body, response);
			response.headers.set(name, value);
		}
	}
	return response;
};
