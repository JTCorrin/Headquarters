<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { looksLikeVendorId } from '$lib/crm/entity-list-filter.js';
	import { getOrgSession } from '$lib/org/index.js';
	import BillsPage from '$lib/components/crm/bills-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const vendorId = $derived(
		looksLikeVendorId(page.url.searchParams.get('vendor_id'))
			? page.url.searchParams.get('vendor_id')
			: null
	);

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}

	function setVendorFilter(next: string | null) {
		const url = new URL(page.url);
		if (next) url.searchParams.set('vendor_id', next);
		else url.searchParams.delete('vendor_id');
		void goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<BillsPage
	{api}
	{session}
	{vendorId}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on bills; page reloads via cacheGeneration.
	}}
	onCreated={(billId) => {
		void goto(`/bills/${billId}`);
	}}
	onVendorFilterChange={setVendorFilter}
	onLogout={handleLogout}
/>
