<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import EmailTemplatesPage from '$lib/components/crm/email-templates-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}
</script>

<EmailTemplatesPage
	{api}
	{session}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on templates; page reloads via cacheGeneration.
	}}
	onOpenNew={() => {
		void goto('/email/templates/new');
	}}
	onLogout={handleLogout}
/>
