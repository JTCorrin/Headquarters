import { createServerClient } from '@supabase/ssr';
import type { RequestEvent } from '@sveltejs/kit';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { readPublicSupabaseConfig } from '$lib/auth/supabase.js';

export function createSupabaseServerClient(event: RequestEvent): SupabaseClient | null {
	const config = readPublicSupabaseConfig(publicEnv);
	if (!config) return null;

	return createServerClient(config.url, config.anonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookies) => {
				for (const { name, value, options } of cookies) {
					event.cookies.set(name, value, {
						...options,
						path: '/'
					});
				}
			}
		}
	});
}

export async function getValidatedSession(
	supabase: SupabaseClient | null
): Promise<{ session: Session | null; user: User | null }> {
	if (!supabase) return { session: null, user: null };

	const {
		data: { session }
	} = await supabase.auth.getSession();
	if (!session) return { session: null, user: null };

	const {
		data: { user },
		error
	} = await supabase.auth.getUser();
	if (error || !user) return { session: null, user: null };

	return { session, user };
}
