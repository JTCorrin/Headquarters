import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseBrowserClient(
	url: string,
	anonKey: string
): SupabaseClient {
	return createBrowserClient(url, anonKey, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: true,
			flowType: 'pkce'
		}
	});
}

export function readPublicSupabaseConfig(env: {
	PUBLIC_SUPABASE_URL?: string;
	PUBLIC_SUPABASE_ANON_KEY?: string;
}): { url: string; anonKey: string } | null {
	const url = env.PUBLIC_SUPABASE_URL?.trim();
	const anonKey = env.PUBLIC_SUPABASE_ANON_KEY?.trim();
	if (!url || !anonKey) return null;
	return { url, anonKey };
}
