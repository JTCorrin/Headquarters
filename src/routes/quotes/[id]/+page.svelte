<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import QuotePage from '$lib/components/crm/quote-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const quoteId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

{#if quoteId}
	<QuotePage
		{api}
		{session}
		{quoteId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/quotes');
		}}
		onConverted={(invoiceId) => {
			void goto(`/invoices/${invoiceId}`);
		}}
		onDeleted={() => {
			void goto('/quotes');
		}}
		onLogout={handleLogout}
	/>
{/if}
