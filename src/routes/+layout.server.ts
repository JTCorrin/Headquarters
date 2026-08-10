import { redirect } from '@sveltejs/kit';
import { isAuthPublicPath } from '$lib/auth/paths.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const authEnabled = locals.supabase !== null;
	const { session, user } = await locals.getValidatedSession();

	if (authEnabled && !user && !isAuthPublicPath(url.pathname)) {
		const next = `${url.pathname}${url.search}`;
		redirect(303, `/login?next=${encodeURIComponent(next)}`);
	}

	return {
		session,
		user,
		authEnabled
	};
};
