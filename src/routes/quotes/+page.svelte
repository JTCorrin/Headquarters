<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { looksLikeClientId } from '$lib/crm/entity-list-filter.js';
	import { getOrgSession } from '$lib/org/index.js';
	import QuotesPage from '$lib/components/crm/quotes-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const initialClientId = $derived(
		looksLikeClientId(page.url.searchParams.get('client_id'))
			? page.url.searchParams.get('client_id')
			: null
	);
	const openCreate = $derived(page.url.searchParams.get('new') === '1');

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}

	function clearOpenCreateParam() {
		const url = new URL(page.url);
		if (!url.searchParams.has('new')) return;
		url.searchParams.delete('new');
		void goto(`${url.pathname}${url.search}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<QuotesPage
	{api}
	{session}
	{initialClientId}
	{openCreate}
	onOpenCreateConsumed={clearOpenCreateParam}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on quotes; page reloads via cacheGeneration.
	}}
	onLogout={handleLogout}
/>
