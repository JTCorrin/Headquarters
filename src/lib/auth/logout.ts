import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { OrgSession } from '$lib/org/session.svelte.js';
import type { AuthSession } from './session.svelte.js';

export async function logoutAndRedirect(
	auth: AuthSession,
	org: OrgSession,
	destination?: string | URL
): Promise<string | null> {
	const { error } = await auth.signOut();
	if (error) return error;

	org.clearSelection();
	org.setMemberships([]);
	if (destination) {
		// Callers only pass local, resolved application URLs.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(destination);
	} else {
		await goto(resolve('/login'));
	}
	return null;
}
