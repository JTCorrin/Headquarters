<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { resolveApiV1BaseUrl } from '$lib/api/v1/base-url.js';
	import { createApiV1Client, setApiV1Client } from '$lib/api/v1/index.js';
	import { toOrgMembershipSummary } from '$lib/api/v1/mappers.js';
	import {
		createAuthSession,
		createSupabaseBrowserClient,
		isAuthPublicPath,
		isOnboardingPath,
		postAuthDestination,
		readPublicSupabaseConfig,
		setAuthSession
	} from '$lib/auth/index.js';
	import { createOrgSession, setOrgSession } from '$lib/org/index.js';
	import favicon from '$lib/assets/favicon.svg';
	import './layout.css';

	let { children } = $props();

	const orgSession = createOrgSession({
		onSwitch: () => {
			// Org-scoped route caches are keyed off session.cacheGeneration in page hosts.
		}
	});

	const supabaseConfig = readPublicSupabaseConfig(env);
	const supabase = supabaseConfig
		? createSupabaseBrowserClient(supabaseConfig.url, supabaseConfig.anonKey)
		: null;
	const auth = createAuthSession({ client: supabase });

	// Empty PUBLIC_API_BASE_URL → same-origin `/api/v1/...` (proxied by SvelteKit).
	const api = createApiV1Client({
		baseUrl: resolveApiV1BaseUrl(env.PUBLIC_API_BASE_URL),
		getOrgId: () => orgSession.selectedOrgId,
		getAccessToken: () => auth.accessToken
	});

	setOrgSession(orgSession);
	setAuthSession(auth);
	setApiV1Client(api);

	let membershipsReady = $state(!auth.enabled);
	let membershipsError = $state<string | null>(null);
	let lastTokenForMemberships = $state<string | null>(null);

	async function refreshMemberships(token: string): Promise<void> {
		membershipsError = null;
		try {
			const rows = await api.organisations.list();
			const memberships = rows.map(toOrgMembershipSummary);
			orgSession.setMemberships(memberships);
			if (
				orgSession.selectedOrgId &&
				!memberships.some((m) => m.org_id === orgSession.selectedOrgId)
			) {
				orgSession.clearSelection();
			}
			if (memberships.length === 1 && !orgSession.selectedOrgId) {
				orgSession.selectOrg(memberships[0]!.org_id);
			}
			membershipsReady = true;
			lastTokenForMemberships = token;
		} catch (error) {
			membershipsReady = true;
			lastTokenForMemberships = token;
			membershipsError =
				error instanceof Error ? error.message : 'Could not load organisations';
		}
	}

	$effect(() => {
		if (!auth.enabled || !auth.ready) return;
		const token = auth.accessToken;
		if (!token) {
			membershipsReady = true;
			lastTokenForMemberships = null;
			orgSession.setMemberships([]);
			return;
		}
		if (token === lastTokenForMemberships) return;
		membershipsReady = false;
		void refreshMemberships(token);
	});

	$effect(() => {
		if (!auth.enabled || !auth.ready) return;
		const path = page.url.pathname;

		if (!auth.session) {
			if (!isAuthPublicPath(path)) {
				void goto('/login');
			}
			return;
		}

		if (!membershipsReady) return;

		if (isAuthPublicPath(path) || path === '/') {
			void goto(
				postAuthDestination({
					membershipCount: orgSession.memberships.length,
					selectedOrgId: orgSession.selectedOrgId
				})
			);
			return;
		}

		if (orgSession.memberships.length === 0 && !isOnboardingPath(path)) {
			void goto('/onboarding/create-org');
			return;
		}

		if (orgSession.memberships.length > 0 && isOnboardingPath(path)) {
			void goto(
				postAuthDestination({
					membershipCount: orgSession.memberships.length,
					selectedOrgId: orgSession.selectedOrgId
				})
			);
			return;
		}

		if (
			orgSession.memberships.length > 1 &&
			!orgSession.selectedOrgId &&
			path.startsWith('/org/')
		) {
			void goto('/select-org');
			return;
		}

		if (path.startsWith('/org/') && !orgSession.selectedOrgId && path !== '/select-org') {
			void goto('/select-org');
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if auth.enabled && auth.ready && auth.session && !membershipsReady}
	<p class="text-muted-foreground p-6 text-sm">Loading workspace…</p>
{:else if membershipsError && auth.session && isAuthPublicPath(page.url.pathname) === false}
	<div class="mx-auto max-w-lg space-y-3 p-6">
		<p class="text-destructive text-sm" role="alert">{membershipsError}</p>
		<button
			type="button"
			class="underline"
			onclick={() => {
				if (auth.accessToken) {
					membershipsReady = false;
					lastTokenForMemberships = null;
					void refreshMemberships(auth.accessToken);
				}
			}}
		>
			Retry
		</button>
	</div>
{:else}
	{@render children()}
{/if}
