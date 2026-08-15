/**
 * Staging Playwright env contract (Forgejo Actions secrets).
 *
 * Required:
 *   E2E_BASE_URL            — staging app origin (e.g. http://192.168.5.136:4173)
 *   E2E_SUPABASE_URL        — staging Kong/Auth (CI gate; journeys use the app UI)
 *   E2E_SUPABASE_ANON_KEY   — staging anon key (never service-role)
 *
 * Optional leftovers (not used — journeys always sign up a unique user):
 *   E2E_USER_EMAIL / E2E_USER_PASSWORD / E2E_ORG_ID
 */

export type E2EEnv = {
	baseURL: string;
	supabaseURL: string;
	supabaseAnonKey: string;
	userEmail?: string;
	userPassword?: string;
	orgId?: string;
};

export function readE2EEnv(): E2EEnv | null {
	const baseURL = process.env.E2E_BASE_URL?.trim();
	const supabaseURL = process.env.E2E_SUPABASE_URL?.trim();
	const supabaseAnonKey = process.env.E2E_SUPABASE_ANON_KEY?.trim();
	if (!baseURL || !supabaseURL || !supabaseAnonKey) return null;
	return {
		baseURL: baseURL.replace(/\/+$/, ''),
		supabaseURL: supabaseURL.replace(/\/+$/, ''),
		supabaseAnonKey,
		userEmail: process.env.E2E_USER_EMAIL?.trim() || undefined,
		userPassword: process.env.E2E_USER_PASSWORD?.trim() || undefined,
		orgId: process.env.E2E_ORG_ID?.trim() || undefined
	};
}

export function requireE2EEnv(): E2EEnv {
	const env = readE2EEnv();
	if (!env) {
		throw new Error(
			'Missing E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY — set Forgejo Actions secrets'
		);
	}
	return env;
}

export function uniqueProofEmail(prefix = 'e2e'): string {
	return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}
