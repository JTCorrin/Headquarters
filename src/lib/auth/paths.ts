/** Routes reachable without a Supabase session when auth is enabled. */
export const AUTH_PUBLIC_PATHS = new Set([
	'/login',
	'/signup',
	'/forgot-password',
	'/check-email',
	'/auth/callback',
	'/invite/accept'
]);

/** Onboarding routes that must not bounce to create-org while memberships catch up. */
export const AUTH_ONBOARDING_PATHS = new Set([
	'/onboarding/create-org',
	'/onboarding/invite-team'
]);

export function isAuthPublicPath(pathname: string): boolean {
	return (
		AUTH_PUBLIC_PATHS.has(pathname) ||
		pathname === '/update-password' ||
		pathname.startsWith('/auth/')
	);
}

/**
 * Signed-in users on these routes should be sent to postAuthDestination
 * (keep update-password and invite accept reachable while authenticated).
 */
export function isPostAuthRedirectPath(pathname: string): boolean {
	return isAuthPublicPath(pathname) && pathname !== '/update-password' && pathname !== '/invite/accept';
}

export function isOnboardingPath(pathname: string): boolean {
	return AUTH_ONBOARDING_PATHS.has(pathname);
}

/**
 * Org-scoped app routes that require a selected organisation (and auth).
 * Keep in sync with `src/lib/org/nav.ts` as routes come online.
 */
export function requiresSelectedOrg(pathname: string): boolean {
	if (pathname === '/select-org') return false;
	if (pathname === '/') return true;
	if (pathname.startsWith('/org/')) return true;
	if (pathname === '/settings' || pathname.startsWith('/settings/')) return true;
	if (pathname === '/contacts' || pathname.startsWith('/contacts/')) return true;
	if (pathname === '/quotes' || pathname.startsWith('/quotes/')) return true;
	if (pathname === '/invoices' || pathname.startsWith('/invoices/')) return true;
	if (pathname === '/recurring-invoices' || pathname.startsWith('/recurring-invoices/'))
		return true;
	if (pathname === '/bills' || pathname.startsWith('/bills/')) return true;
	if (pathname === '/payments' || pathname.startsWith('/payments/')) return true;
	if (pathname === '/products' || pathname.startsWith('/products/')) return true;
	if (pathname === '/documents' || pathname.startsWith('/documents/')) return true;
	if (pathname === '/email' || pathname.startsWith('/email/')) return true;
	if (pathname === '/leads' || pathname.startsWith('/leads/')) return true;
	if (pathname === '/clients' || pathname.startsWith('/clients/')) return true;
	if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return true;
	if (pathname === '/meetings' || pathname.startsWith('/meetings/')) return true;
	if (pathname === '/projects' || pathname.startsWith('/projects/')) return true;
	return false;
}

/**
 * Decide where a signed-in user should go after auth or when leaving public/onboarding routes.
 * With an org selected, land on the Home dashboard (`/`).
 */
export function postAuthDestination(options: {
	membershipCount: number;
	selectedOrgId: string | null;
}): string {
	if (options.membershipCount === 0) return '/onboarding/create-org';
	if (options.membershipCount === 1 && options.selectedOrgId) return '/';
	if (options.membershipCount === 1) return '/select-org';
	if (options.selectedOrgId) return '/';
	return '/select-org';
}

/**
 * Email/password signup with confirmations off. `/check-email` means
 * confirmations are still on and is not success.
 */
export function isPostSignupLandingPath(pathname: string): boolean {
	return pathname === '/onboarding/create-org' || pathname === '/select-org' || pathname === '/';
}

/**
 * After the first organisation is created the app goes to invite-team.
 * Home, org config, and contacts are also success (skip / layout fallback).
 */
export function isPostOrgCreateLandingPath(pathname: string): boolean {
	return (
		pathname === '/onboarding/invite-team' ||
		pathname === '/' ||
		pathname === '/select-org' ||
		pathname === '/org/config' ||
		pathname === '/contacts'
	);
}
