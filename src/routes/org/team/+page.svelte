<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import OrgTeamController from '$lib/components/crm/org-team-controller.svelte';
	import { getOrgSession } from '$lib/org/index.js';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function logout(): Promise<void> {
		await logoutAndRedirect(auth, session);
	}
</script>

<OrgTeamController
	{api}
	{session}
	onMissingOrg={() => {
		void goto(resolve('/select-org'));
	}}
	onLogout={logout}
/>
