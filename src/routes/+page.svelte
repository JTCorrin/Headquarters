<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import DashboardHomePage from '$lib/components/crm/dashboard-home-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const showDashboard = $derived(Boolean(session.selectedOrgId));

	onMount(() => {
		// AuthSessionLayout owns all routing when authentication is enabled.
		if (!auth.enabled && !session.selectedOrgId) {
			void goto(resolve('/select-org'));
		}
	});

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

{#if showDashboard}
	<DashboardHomePage
		{api}
		{session}
		onMissingOrg={() => {
			void goto(resolve('/select-org'));
		}}
		onSwitchNavigate={() => {
			// Stay on home; page reloads via cacheGeneration.
		}}
		onLogout={handleLogout}
	/>
{:else}
	<p class="p-6 text-sm text-muted-foreground">Redirecting…</p>
{/if}
