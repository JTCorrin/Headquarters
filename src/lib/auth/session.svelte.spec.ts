import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createAuthSession } from './session.svelte.js';

function mockClient() {
	const auth = {
		getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
		onAuthStateChange: vi.fn().mockReturnValue({
			data: { subscription: { unsubscribe: vi.fn() } }
		}),
		signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
		signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
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
});
