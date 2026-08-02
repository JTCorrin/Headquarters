<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import RecurringInvoicePage from '$lib/components/crm/recurring-invoice-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const scheduleId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}
</script>

{#if scheduleId}
	<RecurringInvoicePage
		{api}
		{session}
		{scheduleId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/recurring-invoices');
		}}
		onDeleted={() => {
			void goto('/recurring-invoices');
		}}
		onLogout={handleLogout}
	/>
{/if}
