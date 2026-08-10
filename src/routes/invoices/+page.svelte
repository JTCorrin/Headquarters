<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import InvoicesPage from '$lib/components/crm/invoices-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

<InvoicesPage
	{api}
	{session}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on invoices; page reloads via cacheGeneration.
	}}
	onCreated={(invoiceId) => {
		void goto(`/invoices/${invoiceId}`);
	}}
	onLogout={handleLogout}
/>
