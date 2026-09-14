<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import NotePage from '$lib/components/crm/note-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const noteId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

{#if noteId}
	<NotePage
		{api}
		{session}
		{noteId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/notes');
		}}
		onDeleted={() => {
			void goto('/notes');
		}}
		onLogout={handleLogout}
	/>
{/if}
