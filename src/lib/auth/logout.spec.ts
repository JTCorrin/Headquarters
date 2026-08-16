import { goto } from '$app/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '$lib/org/session.svelte.js';
import type { AuthSession } from './session.svelte.js';
import { logoutAndRedirect } from './logout.js';

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

function dependencies(signOutError: string | null = null) {
	const auth = {
		signOut: vi.fn().mockResolvedValue({ error: signOutError })
	} as unknown as AuthSession;
	const org = {
		clearSelection: vi.fn(),
		setMemberships: vi.fn()
	} as unknown as OrgSession;
	return { auth, org };
}

describe('logoutAndRedirect', () => {
	beforeEach(() => {
		vi.mocked(goto).mockReset();
	});

	it('leaves default navigation to the auth guard', async () => {
		const { auth, org } = dependencies();

		await expect(logoutAndRedirect(auth, org)).resolves.toBeNull();

		expect(auth.signOut).toHaveBeenCalledOnce();
		expect(org.clearSelection).toHaveBeenCalledOnce();
		expect(org.setMemberships).toHaveBeenCalledWith([]);
		expect(goto).not.toHaveBeenCalled();
	});

	it('navigates when a public flow supplies an explicit destination', async () => {
		const { auth, org } = dependencies();
		const destination = '/invite/accept?token=invite-token';

		await expect(logoutAndRedirect(auth, org, destination)).resolves.toBeNull();

		expect(goto).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith(destination);
	});

	it('preserves state and navigation when sign out fails', async () => {
		const { auth, org } = dependencies('Could not sign out');

		await expect(logoutAndRedirect(auth, org)).resolves.toBe('Could not sign out');

		expect(org.clearSelection).not.toHaveBeenCalled();
		expect(org.setMemberships).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});
});
