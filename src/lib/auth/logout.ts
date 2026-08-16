import { goto } from '$app/navigation';
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
		// Public-route flows can override the auth guard without racing it.
		// Callers only pass local, resolved application URLs.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(destination);
	}
	// Default logout navigation is owned by AuthSessionLayout's SIGNED_OUT guard.
	return null;
}
