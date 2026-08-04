<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { parseMeetingEntityFilter } from '$lib/crm/entity-list-filter.js';
	import { getOrgSession } from '$lib/org/index.js';
	import MeetingsPage from '$lib/components/crm/meetings-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	const entityFilter = $derived(parseMeetingEntityFilter(page.url.searchParams));

	async function handleLogout() {
		await auth.signOut();
		session.clearSelection();
		session.setMemberships([]);
		void goto('/login');
	}

	function clearEntityFilter() {
		const url = new URL(page.url);
		url.searchParams.delete('entity_type');
		url.searchParams.delete('entity_id');
		void goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<MeetingsPage
	{api}
	{session}
	{entityFilter}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on meetings; page reloads via cacheGeneration.
	}}
	onCreated={(meetingId) => {
		void goto(`/meetings/${meetingId}`);
	}}
	onClearEntityFilter={clearEntityFilter}
	onOpenCalendar={() => {
		void goto('/meetings/calendar');
	}}
	onLogout={handleLogout}
/>
