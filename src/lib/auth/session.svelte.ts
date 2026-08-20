import { getContext, setContext } from 'svelte';
import type {
	AuthChangeEvent,
	Provider,
	Session,
	SupabaseClient,
	User
} from '@supabase/supabase-js';

const AUTH_SESSION_CONTEXT = Symbol('hq.auth-session');

export interface AuthSession {
	readonly ready: boolean;
	readonly enabled: boolean;
	readonly session: Session | null;
	readonly user: User | null;
	readonly accessToken: string | null;
	/** Latest Supabase auth event (`TOKEN_REFRESHED`, `SIGNED_IN`, …). */
	readonly lastAuthEvent: AuthChangeEvent | null;
	signUp(
		email: string,
		password: string,
		options?: { displayName?: string; emailRedirectTo?: string }
	): Promise<{ error: string | null; requiresEmailConfirmation: boolean }>;
	signIn(email: string, password: string): Promise<{ error: string | null }>;
	signInWithOAuth(
		provider: Extract<Provider, 'google' | 'azure'>,
		redirectTo: string
	): Promise<{ error: string | null }>;
	signInWithSSO(domain: string, redirectTo: string): Promise<{ error: string | null }>;
	requestPasswordReset(email: string, redirectTo: string): Promise<{ error: string | null }>;
	updatePassword(password: string): Promise<{ error: string | null }>;
	signOut(): Promise<{ error: string | null }>;
}

export interface CreateAuthSessionOptions {
	client: SupabaseClient | null;
	initialSession?: Session | null;
}

/**
 * Decide how the workspace shell should react when the access token changes.
 * `TOKEN_REFRESHED` must not unmount UI — browsers refresh JWTs on tab focus.
 */
export function membershipRefreshMode(input: {
	previousToken: string | null;
	nextToken: string | null;
	membershipsReady: boolean;
	authEvent: AuthChangeEvent | null;
}): 'clear' | 'skip' | 'adopt-token' | 'quiet' | 'blocking' {
	if (!input.nextToken) return 'clear';
	if (input.nextToken === input.previousToken) return 'skip';
	if (
		(input.authEvent === 'TOKEN_REFRESHED' || input.authEvent === 'SIGNED_IN') &&
		input.membershipsReady
	) {
		return 'adopt-token';
	}
	if (input.membershipsReady && input.previousToken !== null) return 'quiet';
	return 'blocking';
}

function authErrorMessage(error: { message?: string } | null, fallback: string): string {
	return error?.message?.trim() || fallback;
}

export function createAuthSession(options: CreateAuthSessionOptions): AuthSession {
	const client = options.client;
	let ready = $state(!client || options.initialSession !== undefined);
	let session = $state<Session | null>(options.initialSession ?? null);
	let lastAuthEvent = $state<AuthChangeEvent | null>(null);

	if (client) {
		void client.auth.getSession().then(({ data }) => {
			// A slow getSession() must not wipe SIGNED_IN from a later password login.
			if (lastAuthEvent !== null) return;
			session = data.session;
			ready = true;
		});
		client.auth.onAuthStateChange((event, next) => {
			lastAuthEvent = event;
			const isDuplicateSession =
				next !== null &&
				session !== null &&
				next.access_token === session.access_token &&
				next.user.id === session.user.id;
			if (event === 'USER_UPDATED' || !isDuplicateSession) {
				session = next;
			}
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
		get lastAuthEvent() {
			return lastAuthEvent;
		},
		async signUp(email, password, signUpOptions) {
			if (!client) {
				return { error: 'Auth is not configured', requiresEmailConfirmation: false };
			}
			const { data, error } = await client.auth.signUp({
				email,
				password,
				options: {
					data: signUpOptions?.displayName
						? { display_name: signUpOptions.displayName }
						: undefined,
					emailRedirectTo: signUpOptions?.emailRedirectTo
				}
			});
			return {
				error: error ? authErrorMessage(error, 'Could not sign up') : null,
				requiresEmailConfirmation: !error && data.session === null
			};
		},
		async signIn(email, password) {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.signInWithPassword({ email, password });
			return { error: error ? authErrorMessage(error, 'Could not sign in') : null };
		},
		async signInWithOAuth(provider, redirectTo) {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.signInWithOAuth({
				provider,
				options: {
					redirectTo,
					scopes: provider === 'azure' ? 'email openid profile' : undefined
				}
			});
			return { error: error ? authErrorMessage(error, 'Could not start sign in') : null };
		},
		async signInWithSSO(domain, redirectTo) {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.signInWithSSO({
				domain,
				options: { redirectTo }
			});
			return { error: error ? authErrorMessage(error, 'Could not start SSO') : null };
		},
		async requestPasswordReset(email, redirectTo) {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
			return {
				error: error ? authErrorMessage(error, 'Could not send reset email') : null
			};
		},
		async updatePassword(password) {
			if (!client) return { error: 'Auth is not configured' };
			const { error } = await client.auth.updateUser({ password });
			return { error: error ? authErrorMessage(error, 'Could not update password') : null };
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
