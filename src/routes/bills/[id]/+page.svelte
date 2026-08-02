<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import BillPage from '$lib/components/crm/bill-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const billId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}
</script>

{#if billId}
	<BillPage
		{api}
		{session}
		{billId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/bills');
		}}
		onDeleted={() => {
			void goto('/bills');
		}}
		onLogout={handleLogout}
	/>
{/if}
