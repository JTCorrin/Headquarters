<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { resolveApiV1BaseUrl } from '$lib/api/v1/base-url.js';
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

	// Optional override via PUBLIC_API_BASE_URL — dynamic public so fresh checkouts
	// without the key still build (static named imports require the var to exist).
	const api = createApiV1Client({
		baseUrl: resolveApiV1BaseUrl(env.PUBLIC_API_BASE_URL),
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
