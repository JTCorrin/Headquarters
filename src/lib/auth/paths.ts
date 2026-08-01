/** Routes reachable without a Supabase session when auth is enabled. */
export const AUTH_PUBLIC_PATHS = new Set(['/login', '/signup']);

/** Onboarding routes for signed-in users with zero memberships. */
export const AUTH_ONBOARDING_PATHS = new Set([
	'/onboarding/create-org',
	'/onboarding/invite-team',
	'/onboarding/connect'
]);

export function isAuthPublicPath(pathname: string): boolean {
	return AUTH_PUBLIC_PATHS.has(pathname);
}

export function isOnboardingPath(pathname: string): boolean {
	return AUTH_ONBOARDING_PATHS.has(pathname) || pathname.startsWith('/onboarding/');
}

/**
 * Org-scoped app routes that require a selected organisation (and auth).
 * Keep in sync with `src/lib/org/nav.ts` as routes come online.
 */
export function requiresSelectedOrg(pathname: string): boolean {
	if (pathname === '/select-org') return false;
	if (pathname.startsWith('/org/')) return true;
	if (pathname === '/contacts' || pathname.startsWith('/contacts/')) return true;
	return false;
}

/**
 * Decide where a signed-in user should go after auth or from `/`.
 */
export function postAuthDestination(options: {
	membershipCount: number;
	selectedOrgId: string | null;
}): string {
	if (options.membershipCount === 0) return '/onboarding/create-org';
	if (options.membershipCount === 1 && options.selectedOrgId) return '/org/config';
	if (options.membershipCount === 1) return '/select-org';
	if (options.selectedOrgId) return '/org/config';
	return '/select-org';
}
