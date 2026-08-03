<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession, postAuthDestination } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import DashboardHomePage from '$lib/components/crm/dashboard-home-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const showDashboard = $derived(Boolean(session.selectedOrgId));

	$effect(() => {
		if (!auth.ready) return;
		if (session.selectedOrgId) return;

		if (!auth.enabled) {
			void goto('/select-org');
			return;
		}
		if (!auth.session) {
			void goto('/login');
			return;
		}
		void goto(
			postAuthDestination({
				membershipCount: session.memberships.length,
				selectedOrgId: session.selectedOrgId
			})
		);
	});

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}
</script>

{#if showDashboard}
	<DashboardHomePage
		{api}
		{session}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			// Stay on home; page reloads via cacheGeneration.
		}}
		onLogout={handleLogout}
	/>
{:else}
	<p class="text-muted-foreground p-6 text-sm">Redirecting…</p>
{/if}
