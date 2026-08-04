<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import EmailInboxPage from '$lib/components/crm/email-inbox-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const initialMessageId = $derived(page.url.searchParams.get('message'));

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}
</script>

<EmailInboxPage
	{api}
	{session}
	{initialMessageId}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on email; page reloads via cacheGeneration.
	}}
	onLogout={handleLogout}
/>
