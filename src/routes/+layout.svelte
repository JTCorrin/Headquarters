<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createApiV1Client, setApiV1Client } from '$lib/api/v1/index.js';
	import { createOrgSession, setOrgSession } from '$lib/org/index.js';
	import favicon from '$lib/assets/favicon.svg';
	import './layout.css';

	let { children } = $props();

	const session = createOrgSession({
		onSwitch: () => {
			// Org-scoped route caches are keyed off session.cacheGeneration in page hosts.
		}
	});

	const api = createApiV1Client({
		getOrgId: () => session.selectedOrgId,
		getAccessToken: () => null
	});

	setOrgSession(session);
	setApiV1Client(api);

	$effect(() => {
		const path = page.url.pathname;
		const needsOrg = path.startsWith('/org/');
		if (needsOrg && !session.selectedOrgId && path !== '/select-org') {
			void goto('/select-org');
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
