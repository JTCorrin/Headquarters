<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import OrgApiKeysController from '$lib/components/crm/org-api-keys-controller.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}
</script>

<OrgApiKeysController
	{api}
	{session}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on API keys; page reloads via cacheGeneration.
	}}
	onLogout={handleLogout}
/>
