// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient | null;
			getValidatedSession: () => Promise<{
				session: Session | null;
				user: User | null;
			}>;
		}
		// interface Error {}
		interface PageData {
			session: Session | null;
			user: User | null;
			authEnabled: boolean;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
