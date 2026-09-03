<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiCampaign } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { CampaignRow } from './campaigns-columns.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import CampaignsListPage from './campaigns-list-page.svelte';

	export interface CampaignsPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		onOpenNew?: () => void;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		onOpenNew,
		class: className
	}: CampaignsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<CampaignRow[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Campaigns', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function toCampaignRow(campaign: ApiCampaign): CampaignRow {
		return {
			id: campaign.id,
			name: campaign.name,
			status: campaign.status,
			recipientsTotal: campaign.recipient_counts.total,
			recipientsSent: campaign.recipient_counts.sent,
			scheduledAt: campaign.scheduled_at
				? new Date(campaign.scheduled_at).toLocaleString()
				: null,
			updatedAt: new Date(campaign.updated_at).toLocaleString(),
			version: campaign.version
		};
	}

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

	function resetOrgScopedState() {
		rows = [];
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening campaigns.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const listed = await api.campaigns.list({ limit: 100 });
			if (isStale(epoch)) return;

			rows = listed.data.map(toCampaignRow);
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No campaigns yet — create your first mail campaign.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load campaigns.')
			};
		}
	}

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		resetOrgScopedState();
		session.selectOrg(orgId);
		onSwitchNavigate?.(orgId);
		busy = false;
	}

	async function onValidCreate(data: OrganisationCreateData): Promise<boolean> {
		createError = null;
		try {
			const result = await api.organisations.create(toOrganisationCreateBody(data));
			const membership = membershipFromCreateResult(result);
			session.setMemberships([...session.memberships, membership]);
			resetOrgScopedState();
			session.selectOrg(membership.org_id);
			onSwitchNavigate?.(membership.org_id);
			return true;
		} catch (error) {
			createError = userMessage(error, 'Could not create organisation — try again.');
			return false;
		}
	}

	$effect(() => {
		void session.selectedOrgId;
		void session.cacheGeneration;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="campaigns-page">
		<AppShell
			{orgName}
			{navGroups}
			{currentOrgId}
			memberships={session.memberships}
			{switchError}
			{createError}
			{busy}
			{onSwitchOrg}
			onValidCreate={onValidCreate}
			{onLogout}
		>
			<CampaignsListPage
				{orgName}
				{navGroups}
				{rows}
				{viewState}
				onReload={loadAll}
				onNewCampaign={onOpenNew}
				showNav={false}
				class="min-h-0 flex-1"
			/>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="campaigns-page">
		<p class="text-sm text-destructive" role="alert">
			Select an organisation before opening campaigns.
		</p>
	</div>
{/if}
