<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		toAiIntegrationResource,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		aiProviders,
		type AiIntegrationResource,
		type AiProvider
	} from '$lib/schemas/integration.js';
	import {
		canAccessOrgConfigRoutes,
		type MembershipRole
	} from '$lib/schemas/organisation.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import OrgIntegrationsPage from './org-integrations-page.svelte';

	export interface OrgIntegrationsControllerProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: OrgIntegrationsControllerProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let integrations = $state<AiIntegrationResource[]>([]);
	let connectError = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('Integrations', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
	});

	function captureEpoch(): RequestEpoch {
		return { orgId: liveEpoch.orgId, generation: liveEpoch.generation };
	}

	function isStale(epoch: RequestEpoch): boolean {
		return epoch.orgId !== liveEpoch.orgId || epoch.generation !== liveEpoch.generation;
	}

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isValidationError) {
				if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
				return error.message;
			}
			return error.message || fallback;
		}
		return fallback;
	}

	function emptyIntegrations(): AiIntegrationResource[] {
		return aiProviders.map((provider) => ({
			provider,
			credentials_configured: false,
			status: 'disconnected' as const,
			last_verified_at: null,
			last_error_code: null
		}));
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening integrations.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		connectError = null;
		try {
			if (session.memberships.length === 0) {
				const rows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(rows.map(toOrgMembershipSummary));
			}

			const currentRole = (roleFromMemberships(session.memberships, session.selectedOrgId) ??
				'member') as MembershipRole;
			if (!canAccessOrgConfigRoutes(currentRole)) {
				viewState = {
					kind: 'forbidden',
					message: 'Organisation Integrations are available to Owners only.'
				};
				return;
			}

			const rows = await api.integrations.list();
			if (isStale(epoch)) return;
			const mapped = rows.map(toAiIntegrationResource);
			integrations = aiProviders.map(
				(provider) =>
					mapped.find((item) => item.provider === provider) ?? {
						provider,
						credentials_configured: false,
						status: 'disconnected' as const,
						last_verified_at: null,
						last_error_code: null
					}
			);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				integrations = emptyIntegrations();
				viewState = { kind: 'ready' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load integrations.')
			};
		}
	}

	async function onConnect(provider: AiProvider, apiKey: string): Promise<boolean> {
		const epoch = captureEpoch();
		connectError = null;
		try {
			const updated = await api.integrations.connectAi(provider, { api_key: apiKey });
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			const resource = toAiIntegrationResource(updated);
			integrations = integrations.map((item) =>
				item.provider === provider ? resource : item
			);
			return true;
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			connectError = userMessage(error, 'Could not connect provider.');
			return false;
		}
	}

	async function onDisconnect(provider: AiProvider): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			await api.integrations.disconnectAi(provider);
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			integrations = integrations.map((item) =>
				item.provider === provider
					? {
							provider,
							credentials_configured: false,
							status: 'disconnected',
							last_verified_at: null,
							last_error_code: null
						}
					: item
			);
			return true;
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not disconnect provider.')
			};
			return false;
		}
	}

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		integrations = [];
		viewState = { kind: 'loading' };
		session.selectOrg(orgId);
		onSwitchNavigate?.(orgId);
		busy = false;
	}

	$effect(() => {
		void session.selectedOrgId;
		void session.cacheGeneration;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="org-integrations-controller">
		<AppShell
			{currentOrgId}
			memberships={session.memberships}
			{orgName}
			{navGroups}
			{switchError}
			{busy}
			{createError}
			{onSwitchOrg}
			{onLogout}
		>
			{#if !canAccessOrgConfigRoutes(role)}
				<div class="space-y-3 p-6" data-testid="org-integrations-forbidden">
					<p class="text-destructive text-sm" role="alert">
						Organisation Integrations are available to Owners only.
					</p>
					<a class="text-sm font-medium underline underline-offset-2" href="/settings">Open My settings</a>
				</div>
			{:else}
				<OrgIntegrationsPage
					{orgName}
					{navGroups}
					{role}
					{integrations}
					{viewState}
					{connectError}
					onReload={loadAll}
					{onConnect}
					{onDisconnect}
					showNav={false}
				/>
			{/if}
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="org-integrations-controller">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening integrations.
		</p>
	</div>
{/if}
