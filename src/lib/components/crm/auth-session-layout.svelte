<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import type { Session } from '@supabase/supabase-js';
	import { untrack, type Snippet } from 'svelte';
	import { resolveApiV1BaseUrl } from '$lib/api/v1/base-url.js';
	import { createApiV1Client, setApiV1Client } from '$lib/api/v1/index.js';
	import { themePreferenceFromApi, toOrgMembershipSummary } from '$lib/api/v1/mappers.js';
	import {
		createAuthSession,
		createSupabaseBrowserClient,
		isAuthPublicPath,
		isOnboardingPath,
		membershipRefreshMode,
		postAuthDestination,
		readPublicSupabaseConfig,
		requiresSelectedOrg,
		safeNextPath,
		setAuthSession
	} from '$lib/auth/index.js';
	import { createOrgSession, setOrgSession } from '$lib/org/index.js';
	import {
		applyResolvedTheme,
		resolveThemeChoice,
		subscribePrefersDark
	} from '$lib/theme/index.js';

	export interface AuthSessionLayoutProps {
		children: Snippet;
		initialSession: Session | null;
		userId?: string | null;
	}

	let { children, initialSession, userId = null }: AuthSessionLayoutProps = $props();

	// This component is keyed by user id in +layout, so these values are immutable per instance.
	const initialUserId = untrack(() => userId);
	const serverSession = untrack(() => initialSession);
	const orgSession = createOrgSession({
		userId: initialUserId,
		onSwitch: () => {
			// Org-scoped route caches are keyed off session.cacheGeneration in page hosts.
		}
	});

	const supabaseConfig = readPublicSupabaseConfig(env);
	const supabase = supabaseConfig
		? createSupabaseBrowserClient(supabaseConfig.url, supabaseConfig.anonKey)
		: null;
	const auth = createAuthSession({ client: supabase, initialSession: serverSession });

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
			const [rows, prefs] = await Promise.all([
				api.organisations.list(),
				api.profilePreferences.get().catch(() => null)
			]);
			const memberships = rows.map(toOrgMembershipSummary);
			orgSession.setMemberships(memberships);
			if (prefs) {
				orgSession.setThemePreference(themePreferenceFromApi(prefs.theme_preference));
			}
			if (
				orgSession.selectedOrgId &&
				!memberships.some((membership) => membership.org_id === orgSession.selectedOrgId)
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
			membershipsError = error instanceof Error ? error.message : 'Could not load organisations';
		}
	}

	$effect(() => {
		if (!auth.enabled || !auth.ready) return;
		const token = auth.accessToken;
		const mode = membershipRefreshMode({
			previousToken: lastTokenForMemberships,
			nextToken: token,
			membershipsReady,
			authEvent: auth.lastAuthEvent
		});

		if (mode === 'clear') {
			membershipsReady = true;
			lastTokenForMemberships = null;
			orgSession.setMemberships([]);
			orgSession.setThemePreference('org_default');
			applyResolvedTheme('org_default', 'system');
			return;
		}
		if (mode === 'skip') return;
		// Tab-focus JWT refresh: keep the shell mounted; API client already reads the new token.
		if (mode === 'adopt-token') {
			lastTokenForMemberships = token;
			return;
		}
		if (mode === 'blocking') {
			membershipsReady = false;
		}
		void refreshMemberships(token!);
	});

	// Apply organisation / personal theme to <html class="dark">.
	$effect(() => {
		const personal = orgSession.themePreference;
		const orgDefault =
			orgSession.memberships.find((membership) => membership.org_id === orgSession.selectedOrgId)
				?.theme_default ?? 'system';
		applyResolvedTheme(personal, orgDefault);

		const choice = resolveThemeChoice(personal, orgDefault);
		if (choice !== 'system') return;
		return subscribePrefersDark(() => {
			applyResolvedTheme(personal, orgDefault);
		});
	});

	$effect(() => {
		if (!auth.enabled || !auth.ready) return;
		const path = page.url.pathname;
		const acceptingInvitation = path === '/invite/accept';
		const invitingTeam = path === '/onboarding/invite-team';

		if (!auth.session) {
			if (!isAuthPublicPath(path)) {
				const next = `${path}${page.url.search}`;
				void goto(resolve(`/login?next=${encodeURIComponent(next)}`));
			}
			return;
		}

		if (!membershipsReady) return;

		if (isAuthPublicPath(path) && path !== '/update-password' && !acceptingInvitation) {
			const requestedNext = page.url.searchParams.get('next');
			const next = safeNextPath(requestedNext);
			const destination =
				requestedNext && next !== '/'
					? next
					: postAuthDestination({
							membershipCount: orgSession.memberships.length,
							selectedOrgId: orgSession.selectedOrgId
						});
			// `destination` is either generated locally or sanitized by safeNextPath.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(destination);
			return;
		}

		if (orgSession.memberships.length === 0 && !isOnboardingPath(path) && !acceptingInvitation) {
			void goto(resolve('/onboarding/create-org'));
			return;
		}

		if (invitingTeam) {
			const selectedMembership = orgSession.memberships.find(
				(membership) => membership.org_id === orgSession.selectedOrgId
			);
			if (selectedMembership?.role !== 'owner') {
				const destination = postAuthDestination({
					membershipCount: orgSession.memberships.length,
					selectedOrgId: orgSession.selectedOrgId
				});
				// postAuthDestination only returns known internal routes.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				void goto(destination);
				return;
			}
		}

		if (orgSession.memberships.length > 0 && isOnboardingPath(path) && !invitingTeam) {
			const destination = postAuthDestination({
				membershipCount: orgSession.memberships.length,
				selectedOrgId: orgSession.selectedOrgId
			});
			// postAuthDestination only returns known internal routes.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(destination);
			return;
		}

		if (requiresSelectedOrg(path) && !orgSession.selectedOrgId) {
			void goto(resolve('/select-org'));
		}
	});
</script>

{#if auth.enabled && auth.ready && auth.session && !membershipsReady}
	<p class="p-6 text-sm text-muted-foreground">Loading workspace…</p>
{:else if membershipsError && auth.session && isAuthPublicPath(page.url.pathname) === false}
	<div class="mx-auto max-w-lg space-y-3 p-6">
		<p class="text-sm text-destructive" role="alert">{membershipsError}</p>
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
