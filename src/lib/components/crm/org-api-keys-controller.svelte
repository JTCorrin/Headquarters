<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiOrgApiKey } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { ApiKeyCreateData } from '$lib/schemas/api-key.js';
	import {
		canAccessApiKeys,
		type MembershipRole
	} from '$lib/schemas/organisation.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import OrgApiKeysPage from './org-api-keys-page.svelte';

	export interface OrgApiKeysControllerProps {
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
	}: OrgApiKeysControllerProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let keys = $state<ApiOrgApiKey[]>([]);
	let createError = $state<string | null>(null);
	let revealedSecret = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createOrgError = $state<string | null>(null);
	let busy = $state(false);

	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('API keys', role));
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


	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening API keys.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		createError = null;
		try {
			if (session.memberships.length === 0) {
				const rows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(rows.map(toOrgMembershipSummary));
			}

			const currentRole = (roleFromMemberships(session.memberships, session.selectedOrgId) ??
				'member') as MembershipRole;
			if (!canAccessApiKeys(currentRole)) {
				viewState = {
					kind: 'forbidden',
					message: 'API keys are available to Owners and Admins.'
				};
				return;
			}

			const rows = await api.apiKeys.list();
			if (isStale(epoch)) return;
			keys = rows;
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load API keys.')
			};
		}
	}

	async function onCreate(input: ApiKeyCreateData): Promise<boolean> {
		const epoch = captureEpoch();
		createError = null;
		try {
			const created = await api.apiKeys.create({
				name: input.name,
				role: input.role
			});
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			const { secret, ...publicKey } = created;
			revealedSecret = secret;
			keys = [publicKey, ...keys.filter((row) => row.id !== publicKey.id)];
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			createError = userMessage(error, 'Could not create API key.');
			return false;
		}
	}

	async function onRevoke(id: string): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			await api.apiKeys.revoke(id);
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			keys = keys.filter((row) => row.id !== id);
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) {
				void loadAll();
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not revoke API key.')
			};
			return false;
		}
	}

	function onDismissSecret() {
		revealedSecret = null;
	}

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		keys = [];
		revealedSecret = null;
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
	<div class={className} data-testid="org-api-keys-controller">
		<AppShell
			{currentOrgId}
			memberships={session.memberships}
			{orgName}
			{navGroups}
			{switchError}
			{busy}
			createError={createOrgError}
			{onSwitchOrg}
			{onLogout}
		>
			{#if !canAccessApiKeys(role)}
				<div class="space-y-3 p-6" data-testid="org-api-keys-forbidden">
					<p class="text-destructive text-sm" role="alert">
						API keys are available to Owners and Admins.
					</p>
					<a class="text-sm font-medium underline underline-offset-2" href="/settings"
						>Open My settings</a
					>
				</div>
			{:else}
				<OrgApiKeysPage
					{orgName}
					{navGroups}
					{role}
					{keys}
					{viewState}
					{createError}
					{revealedSecret}
					onReload={loadAll}
					{onCreate}
					{onRevoke}
					{onDismissSecret}
					showNav={false}
				/>
			{/if}
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="org-api-keys-controller">
		<p class="text-muted-foreground text-sm">Select an organisation to manage API keys.</p>
	</div>
{/if}
