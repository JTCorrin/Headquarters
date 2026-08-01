import { getContext, setContext } from 'svelte';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

const AUTH_SESSION_CONTEXT = Symbol('hq.auth-session');

export interface AuthSession {
	readonly ready: boolean;
	readonly enabled: boolean;
	readonly session: Session | null;
	readonly user: User | null;
	readonly accessToken: string | null;
	signUp(email: string, password: string): Promise<{ error: string | null }>;
	signIn(email: string, password: string): Promise<{ error: string | null }>;
	signOut(): Promise<{ error: string | null }>;
}

export interface CreateAuthSessionOptions {
	client: SupabaseClient | null;
}

function authErrorMessage(error: { message?: string } | null, fallback: string): string {
	return error?.message?.trim() || fallback;
}

export function createAuthSession(options: CreateAuthSessionOptions): AuthSession {
	const client = options.client;
	let ready = $state(!client);
	let session = $state<Session | null>(null);

	if (client) {
		void client.auth.getSession().then(({ data }) => {
			session = data.session;
			ready = true;
		});
		client.auth.onAuthStateChange((_event, next) => {
			session = next;
			ready = true;
		});
	}

	return {
		get ready() {
			return ready;
		},
		get enabled() {
			return client !== null;
		},
		get session() {
			return session;
		},
		get user() {
			return session?.user ?? null;
		},
		get accessToken() {
			return session?.access_token ?? null;
		},
		async signUp(email, password) {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.signUp({ email, password });
			return { error: error ? authErrorMessage(error, 'Could not sign up') : null };
		},
		async signIn(email, password) {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.signInWithPassword({ email, password });
			return { error: error ? authErrorMessage(error, 'Could not sign in') : null };
		},
		async signOut() {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.signOut();
			return { error: error ? authErrorMessage(error, 'Could not sign out') : null };
		}
	};
}

export function setAuthSession(session: AuthSession): void {
	setContext(AUTH_SESSION_CONTEXT, session);
}

export function getAuthSession(): AuthSession {
	const session = getContext<AuthSession | undefined>(AUTH_SESSION_CONTEXT);
	if (!session) {
		throw new Error('Auth session was not provided. Call setAuthSession in +layout.');
	}
	return session;
}
