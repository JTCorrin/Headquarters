import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createAuthSession, membershipRefreshMode } from './session.svelte.js';

function mockClient() {
	const auth = {
		getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
		onAuthStateChange: vi.fn().mockReturnValue({
			data: { subscription: { unsubscribe: vi.fn() } }
		}),
		signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
		signInWithPassword: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
		signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
		signInWithSSO: vi.fn().mockResolvedValue({ error: null }),
		resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
		updateUser: vi.fn().mockResolvedValue({ error: null }),
		signOut: vi.fn().mockResolvedValue({ error: null })
	};
	return {
		auth,
		client: { auth } as unknown as SupabaseClient
	};
}

describe('membershipRefreshMode', () => {
	it('keeps the workspace mounted across TOKEN_REFRESHED', () => {
		expect(
			membershipRefreshMode({
				previousToken: 'old-jwt',
				nextToken: 'new-jwt',
				membershipsReady: true,
				authEvent: 'TOKEN_REFRESHED'
			})
		).toBe('adopt-token');
	});

	it('adopts a changed token from SIGNED_IN when memberships are ready', () => {
		expect(
			membershipRefreshMode({
				previousToken: 'old-jwt',
				nextToken: 'new-jwt',
				membershipsReady: true,
				authEvent: 'SIGNED_IN'
			})
		).toBe('adopt-token');
	});

	it('blocks the shell only for the first memberships load', () => {
		expect(
			membershipRefreshMode({
				previousToken: null,
				nextToken: 'jwt',
				membershipsReady: false,
				authEvent: 'SIGNED_IN'
			})
		).toBe('blocking');
	});

	it('refreshes quietly when already ready and the event is not a token refresh', () => {
		expect(
			membershipRefreshMode({
				previousToken: 'old-jwt',
				nextToken: 'new-jwt',
				membershipsReady: true,
				authEvent: 'USER_UPDATED'
			})
		).toBe('quiet');
	});

	it('clears memberships when signed out', () => {
		expect(
			membershipRefreshMode({
				previousToken: 'jwt',
				nextToken: null,
				membershipsReady: true,
				authEvent: 'SIGNED_OUT'
			})
		).toBe('clear');
	});

	it('skips when the token is unchanged', () => {
		expect(
			membershipRefreshMode({
				previousToken: 'same-jwt',
				nextToken: 'same-jwt',
				membershipsReady: true,
				authEvent: 'TOKEN_REFRESHED'
			})
		).toBe('skip');
	});
});

describe('auth session', () => {
	it('reports confirmation-required signup and forwards profile metadata', async () => {
		const { auth, client } = mockClient();
		const session = createAuthSession({ client, initialSession: null });

		await expect(
			session.signUp('person@example.test', 'long-password', {
				displayName: 'Person Name',
				emailRedirectTo: 'https://crm.example/auth/callback'
			})
		).resolves.toEqual({ error: null, requiresEmailConfirmation: true });
		expect(auth.signUp).toHaveBeenCalledWith({
			email: 'person@example.test',
			password: 'long-password',
			options: {
				data: { display_name: 'Person Name' },
				emailRedirectTo: 'https://crm.example/auth/callback'
			}
		});
	});

	it('starts OAuth and enterprise SSO with explicit callbacks', async () => {
		const { auth, client } = mockClient();
		const session = createAuthSession({ client, initialSession: null });

		await session.signInWithOAuth('azure', 'https://crm.example/auth/callback');
		await session.signInWithSSO('example.com', 'https://crm.example/auth/callback');

		expect(auth.signInWithOAuth).toHaveBeenCalledWith({
			provider: 'azure',
			options: {
				redirectTo: 'https://crm.example/auth/callback',
				scopes: 'email openid profile'
			}
		});
		expect(auth.signInWithSSO).toHaveBeenCalledWith({
			domain: 'example.com',
			options: { redirectTo: 'https://crm.example/auth/callback' }
		});
	});

	it('seeds the access token from the validated server session', () => {
		const { client } = mockClient();
		const initialSession = {
			access_token: 'validated-token',
			user: { id: 'user-1' }
		} as Session;
		const session = createAuthSession({ client, initialSession });

		expect(session.accessToken).toBe('validated-token');
		expect(session.user?.id).toBe('user-1');
		expect(session.ready).toBe(true);
	});

	it('applies the password grant session before onAuthStateChange', async () => {
		const { auth, client } = mockClient();
		const granted = {
			access_token: 'grant-token',
			user: { id: 'user-1' }
		} as Session;
		auth.signInWithPassword.mockResolvedValue({ data: { session: granted }, error: null });
		const session = createAuthSession({ client, initialSession: null });

		await expect(session.signIn('person@example.test', 'long-password')).resolves.toEqual({
			error: null
		});
		expect(session.accessToken).toBe('grant-token');
		expect(session.lastAuthEvent).toBe('SIGNED_IN');
		expect(session.ready).toBe(true);
	});

	it('does not let a stale getSession overwrite SIGNED_IN', async () => {
		let resolveGetSession: (value: { data: { session: Session | null } }) => void = () => {};
		const { auth, client } = mockClient();
		auth.getSession.mockReturnValue(
			new Promise((resolve) => {
				resolveGetSession = resolve;
			})
		);

		const session = createAuthSession({ client, initialSession: null });
		const listener = auth.onAuthStateChange.mock.calls[0]?.[0] as (
			event: string,
			next: Session | null
		) => void;

		listener('SIGNED_IN', {
			access_token: 'signed-in-token',
			user: { id: 'user-1' }
		} as Session);
		expect(session.accessToken).toBe('signed-in-token');

		resolveGetSession({ data: { session: null } });
		await Promise.resolve();
		expect(session.accessToken).toBe('signed-in-token');
	});

	it('does not replace the session for duplicate SIGNED_IN snapshots', () => {
		const { auth, client } = mockClient();
		const initialSession = {
			access_token: 'same-jwt',
			expires_at: 100,
			user: { id: 'user-1', user_metadata: { display_name: 'Original' } }
		} as unknown as Session;
		const session = createAuthSession({ client, initialSession });
		const listener = auth.onAuthStateChange.mock.calls[0]?.[0] as (
			event: string,
			next: Session | null
		) => void;
		const duplicate = {
			access_token: 'same-jwt',
			expires_at: 200,
			user: { id: 'user-1', user_metadata: { display_name: 'Duplicate' } }
		} as unknown as Session;
		const sessionBeforeDuplicate = session.session;

		listener('SIGNED_IN', duplicate);

		expect(session.session).toBe(sessionBeforeDuplicate);
		expect(session.session?.expires_at).toBe(100);
		expect(session.user?.user_metadata.display_name).toBe('Original');
		expect(session.lastAuthEvent).toBe('SIGNED_IN');
		expect(session.ready).toBe(true);
	});

	it('applies USER_UPDATED snapshots even when token and user id are unchanged', () => {
		const { auth, client } = mockClient();
		const initialSession = {
			access_token: 'same-jwt',
			user: { id: 'user-1', user_metadata: { display_name: 'Before' } }
		} as unknown as Session;
		const session = createAuthSession({ client, initialSession });
		const listener = auth.onAuthStateChange.mock.calls[0]?.[0] as (
			event: string,
			next: Session | null
		) => void;
		const updated = {
			access_token: 'same-jwt',
			user: { id: 'user-1', user_metadata: { display_name: 'After' } }
		} as unknown as Session;
		const sessionBeforeUpdate = session.session;

		listener('USER_UPDATED', updated);

		expect(session.session).not.toBe(sessionBeforeUpdate);
		expect(session.user?.user_metadata.display_name).toBe('After');
		expect(session.lastAuthEvent).toBe('USER_UPDATED');
	});

	it('records auth change events including TOKEN_REFRESHED', () => {
		const { auth, client } = mockClient();
		const session = createAuthSession({ client, initialSession: null });
		const listener = auth.onAuthStateChange.mock.calls[0]?.[0] as (
			event: string,
			next: Session | null
		) => void;

		listener('TOKEN_REFRESHED', {
			access_token: 'refreshed',
			user: { id: 'user-1' }
		} as Session);

		expect(session.lastAuthEvent).toBe('TOKEN_REFRESHED');
		expect(session.accessToken).toBe('refreshed');
	});

	it('applies a signed-out null transition', () => {
		const { auth, client } = mockClient();
		const initialSession = {
			access_token: 'signed-in-token',
			user: { id: 'user-1' }
		} as Session;
		const session = createAuthSession({ client, initialSession });
		const listener = auth.onAuthStateChange.mock.calls[0]?.[0] as (
			event: string,
			next: Session | null
		) => void;

		listener('SIGNED_OUT', null);

		expect(session.session).toBeNull();
		expect(session.accessToken).toBeNull();
		expect(session.lastAuthEvent).toBe('SIGNED_OUT');
	});
});
