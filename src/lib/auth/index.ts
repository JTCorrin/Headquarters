export {
	createAuthSession,
	getAuthSession,
	setAuthSession,
	type AuthSession,
	type CreateAuthSessionOptions
} from './session.svelte.js';
export {
	buildApiV1ProxyUrl,
	forwardProxyHeaders,
	resolveApiV1Upstream
} from './proxy.js';
export {
	AUTH_ONBOARDING_PATHS,
	AUTH_PUBLIC_PATHS,
	isAuthPublicPath,
	isOnboardingPath,
	postAuthDestination
} from './paths.js';
export { createSupabaseBrowserClient, readPublicSupabaseConfig } from './supabase.js';
