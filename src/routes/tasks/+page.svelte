<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { parseTaskEntityFilter } from '$lib/crm/entity-list-filter.js';
	import { getOrgSession } from '$lib/org/index.js';
	import TasksPage from '$lib/components/crm/tasks-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const initialEditTaskId = $derived(page.url.searchParams.get('edit'));
	const entityFilter = $derived(parseTaskEntityFilter(page.url.searchParams));

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}

	function clearEntityFilter() {
		const url = new URL(page.url);
		url.searchParams.delete('entity_type');
		url.searchParams.delete('entity_id');
		void goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<TasksPage
	{api}
	{session}
	{initialEditTaskId}
	{entityFilter}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on tasks; page reloads via cacheGeneration.
	}}
	onClearEntityFilter={clearEntityFilter}
	onLogout={handleLogout}
/>
