<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import PlaybookEditorPage from '$lib/components/crm/playbook-editor-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const playbookId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

{#if playbookId}
	<PlaybookEditorPage
		{api}
		{session}
		{playbookId}
		onMissingOrg={() => {
			void goto(resolve('/select-org'));
		}}
		onSwitchNavigate={() => {
			void goto(resolve('/playbooks'));
		}}
		onLogout={handleLogout}
	/>
{/if}
