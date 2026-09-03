<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import CampaignPage from '$lib/components/crm/campaign-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const campaignId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

{#if campaignId}
	<CampaignPage
		{api}
		{session}
		{campaignId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/campaigns');
		}}
		onSaved={(id) => {
			if (campaignId === 'new') {
				void goto(`/campaigns/${id}`);
			}
		}}
		onBack={() => {
			void goto('/campaigns');
		}}
		onDeleted={() => {
			void goto('/campaigns');
		}}
		onLogout={handleLogout}
	/>
{/if}
