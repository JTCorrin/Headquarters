import { redirect } from '@sveltejs/kit';
import { safeNextPath } from '$lib/auth/redirect.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	const code = url.searchParams.get('code');
	const next = safeNextPath(url.searchParams.get('next'));

	if (!locals.supabase || !code) {
		redirect(303, `/login?error=${encodeURIComponent('The authentication link is invalid or expired.')}`);
	}

	const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
	if (error) {
		redirect(303, `/login?error=${encodeURIComponent('Could not complete authentication. Try again.')}`);
	}

	redirect(303, next);
};
