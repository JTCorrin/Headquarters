<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import ClientPage from '$lib/components/crm/client-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const clientId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

{#if clientId}
	<ClientPage
		{api}
		{session}
		{clientId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/clients');
		}}
		onLogout={handleLogout}
	/>
{/if}
