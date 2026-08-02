<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import InvoicePage from '$lib/components/crm/invoice-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const invoiceId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}
</script>

{#if invoiceId}
	<InvoicePage
		{api}
		{session}
		{invoiceId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/invoices');
		}}
		onDeleted={() => {
			void goto('/invoices');
		}}
		onLogout={handleLogout}
	/>
{/if}
