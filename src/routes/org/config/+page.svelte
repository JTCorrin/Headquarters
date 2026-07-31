<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import OrgConfigPage from '$lib/components/crm/org-config-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
</script>

<OrgConfigPage
	{api}
	{session}
	onMissingOrg={() => {
		void goto('/select-org');
	}}
	onSwitchNavigate={() => {
		// Stay on config; page reloads via cacheGeneration.
	}}
/>
