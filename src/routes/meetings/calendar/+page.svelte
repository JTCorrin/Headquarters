<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import MeetingsCalendarPage from '$lib/components/crm/meetings-calendar-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

<MeetingsCalendarPage
	{api}
	{session}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on calendar; page reloads via cacheGeneration.
	}}
	onCreated={(meetingId) => {
		void goto(`/meetings/${meetingId}`);
	}}
	onOpenMeeting={(meetingId) => {
		void goto(`/meetings/${meetingId}`);
	}}
	onOpenList={() => {
		void goto('/meetings');
	}}
	onLogout={handleLogout}
/>
