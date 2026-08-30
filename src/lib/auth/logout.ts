import { resolve } from '$app/paths';
import type { OrgSession } from '$lib/org/session.svelte.js';
import type { AuthSession } from './session.svelte.js';

export type LogoutNavigation = (destination: string | URL) => void;

export interface LogoutOptions {
	destination?: string | URL;
	navigate?: LogoutNavigation;
}

function navigateDocument(destination: string | URL): void {
	window.location.assign(destination.toString());
}

export async function logoutAndRedirect(
	auth: AuthSession,
	org: OrgSession,
	options: LogoutOptions = {}
): Promise<string | null> {
	const { error } = await auth.signOut();
	if (error) return error;

	org.clearSelection();
	org.setMemberships([]);
	const destination = options.destination ?? resolve('/login');
	(options.navigate ?? navigateDocument)(destination);
	return null;
}
