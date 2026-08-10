<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import ProjectsPage from '$lib/components/crm/projects-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

<ProjectsPage
	{api}
	{session}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on projects; page reloads via cacheGeneration.
	}}
	onSelectProject={(projectId) => {
		void goto(`/projects/${projectId}`);
	}}
	onCreated={(projectId) => {
		void goto(`/projects/${projectId}`);
	}}
	onLogout={handleLogout}
/>
