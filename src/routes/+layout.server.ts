import { hostedEntitlementForUser, isHostedBillingEnabled } from '$lib/server/hosted-billing.js';
import { error, redirect } from '@sveltejs/kit';
import { isAuthPublicPath } from '$lib/auth/paths.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const authEnabled = locals.supabase !== null;
	const { session, user } = await locals.getValidatedSession();

	if (authEnabled && !user && !isAuthPublicPath(url.pathname)) {
		const next = `${url.pathname}${url.search}`;
		redirect(303, `/login?next=${encodeURIComponent(next)}`);
	}

	if (
		user &&
		isHostedBillingEnabled() &&
		url.pathname !== '/billing' &&
		!isAuthPublicPath(url.pathname)
	) {
		let entitlement;
		try {
			entitlement = await hostedEntitlementForUser(user.id);
		} catch {
			error(503, 'Billing is temporarily unavailable. Please try again.');
		}
		if (!entitlement) redirect(303, '/billing');
	}
	return {
		session,
		user,
		authEnabled
	};
};
