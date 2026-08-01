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
