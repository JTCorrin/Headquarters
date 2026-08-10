<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import PersonalSettingsController from '$lib/components/crm/personal-settings-controller.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

<PersonalSettingsController
	{api}
	{session}
	onMissingOrg={() => {
		void goto(resolve('/select-org'));
	}}
	onSwitchNavigate={() => {
		// Stay on settings; page reloads via cacheGeneration.
	}}
	onLogout={handleLogout}
/>
