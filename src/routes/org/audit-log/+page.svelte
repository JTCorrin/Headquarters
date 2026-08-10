<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import AuditLogPage from '$lib/components/crm/audit-log-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

<AuditLogPage
	{api}
	{session}
	onMissingOrg={() => {
		void goto(resolve('/select-org'));
	}}
	onSwitchNavigate={() => {
		// Stay on audit log; page reloads via cacheGeneration.
	}}
	onLogout={handleLogout}
/>
