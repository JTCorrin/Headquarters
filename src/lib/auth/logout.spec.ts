import { describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '$lib/org/session.svelte.js';
import type { AuthSession } from './session.svelte.js';
import { logoutAndRedirect, type LogoutNavigation } from './logout.js';

function dependencies(signOutError: string | null = null, calls: string[] = []) {
	const auth = {
		signOut: vi.fn().mockImplementation(async () => {
			calls.push('sign-out');
			return { error: signOutError };
		})
	} as unknown as AuthSession;
	const org = {
		clearSelection: vi.fn(() => calls.push('clear-selection')),
		setMemberships: vi.fn(() => calls.push('clear-memberships'))
	} as unknown as OrgSession;
	return { auth, org };
}

describe('logoutAndRedirect', () => {
	it('reloads the resolved login route after clearing auth and org state', async () => {
		const calls: string[] = [];
		const { auth, org } = dependencies(null, calls);
		const navigate: LogoutNavigation = vi.fn(() => calls.push('navigate'));

		await expect(logoutAndRedirect(auth, org, { navigate })).resolves.toBeNull();

		expect(auth.signOut).toHaveBeenCalledOnce();
		expect(org.clearSelection).toHaveBeenCalledOnce();
		expect(org.setMemberships).toHaveBeenCalledWith([]);
		expect(navigate).toHaveBeenCalledWith('/login');
		expect(calls).toEqual(['sign-out', 'clear-selection', 'clear-memberships', 'navigate']);
	});

	it('reloads an explicit public-flow destination', async () => {
		const { auth, org } = dependencies();
		const destination = '/invite/accept?token=invite-token';
		const navigate: LogoutNavigation = vi.fn();

		await expect(logoutAndRedirect(auth, org, { destination, navigate })).resolves.toBeNull();

		expect(navigate).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith(destination);
	});

	it('preserves state and navigation when sign out fails', async () => {
		const { auth, org } = dependencies('Could not sign out');
		const navigate: LogoutNavigation = vi.fn();

		await expect(logoutAndRedirect(auth, org, { navigate })).resolves.toBe('Could not sign out');

		expect(org.clearSelection).not.toHaveBeenCalled();
		expect(org.setMemberships).not.toHaveBeenCalled();
		expect(navigate).not.toHaveBeenCalled();
	});
});
