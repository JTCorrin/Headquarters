<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import NotesPage from '$lib/components/crm/notes-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

<NotesPage
	{api}
	{session}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on notes; page reloads via cacheGeneration.
	}}
	onCreated={(noteId) => {
		void goto(`/notes/${noteId}`);
	}}
	onOpenNote={(noteId) => {
		void goto(`/notes/${noteId}`);
	}}
	onLogout={handleLogout}
/>
