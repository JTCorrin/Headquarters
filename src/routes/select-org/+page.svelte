<script lang="ts">
	import { goto } from '$app/navigation';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import SelectOrgPage from '$lib/components/crm/select-org-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
</script>

<SelectOrgPage
	{api}
	{session}
	onSelected={() => {
		void goto('/org/config');
	}}
/>
