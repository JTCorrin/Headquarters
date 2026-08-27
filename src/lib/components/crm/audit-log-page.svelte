<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage as sharedUserMessage } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toAuditLogListItem,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { AuditLogListItem } from '$lib/schemas/audit-event.js';
	import {
		canAccessAuditLog,
		type MembershipRole,
		type OrganisationCreateData
	} from '$lib/schemas/organisation.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import AuditLogListPage, { type AuditLogFilters } from './audit-log-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface AuditLogPageProps {
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
	}: AuditLogPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<AuditLogListItem[]>([]);
	let filters = $state<AuditLogFilters>({ from: '', to: '', action: '', actorId: '' });
	let applied = $state<AuditLogFilters>({ from: '', to: '', action: '', actorId: '' });
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
	const navGroups = $derived(appNavGroups('Audit log', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const allowed = $derived(canAccessAuditLog(role));

	function userMessage(error: unknown, fallback: string): string {
		return sharedUserMessage(error, fallback, {
			notFoundMessage: 'Audit log is not available yet.'
		});
	}

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		from: string;
		to: string;
		action: string;
		actorId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		from: '',
		to: '',
		action: '',
		actorId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.from = applied.from;
		liveEpoch.to = applied.to;
		liveEpoch.action = applied.action;
		liveEpoch.actorId = applied.actorId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			from: liveEpoch.from,
			to: liveEpoch.to,
			action: liveEpoch.action,
			actorId: liveEpoch.actorId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.from !== liveEpoch.from ||
			epoch.to !== liveEpoch.to ||
			epoch.action !== liveEpoch.action ||
			epoch.actorId !== liveEpoch.actorId
		);
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
				message: 'Select an organisation before opening the audit log.'
			};
			return;
		}

		if (!allowed) {
			rows = [];
			viewState = {
				kind: 'forbidden',
				message: 'Only organisation Owners and Admins can view the audit log.'
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

			const result = await api.auditEvents.list({
				limit: 100,
				from: applied.from.trim() || undefined,
				to: applied.to.trim() || undefined,
				action: applied.action.trim() || undefined,
				actor_id: applied.actorId.trim() || undefined
			});
			if (isStale(epoch)) return;
			rows = result.data.map(toAuditLogListItem);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			rows = [];
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			if (
				isApiClientError(error) &&
				(error.status === 404 || error.code === 'NOT_FOUND' || error.status === 501)
			) {
				viewState = { kind: 'ready' };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load audit log.')
			};
		}
	}

	function onApplyFilters() {
		applied = { ...filters };
	}

	function onClearFilters() {
		filters = { from: '', to: '', action: '', actorId: '' };
		applied = { from: '', to: '', action: '', actorId: '' };
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
		void role;
		void applied.from;
		void applied.to;
		void applied.action;
		void applied.actorId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="audit-log-page">
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
			{onValidCreate}
		>
			<div class="flex min-h-0 flex-1 flex-col">
				{#if viewState.kind !== 'ready'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{:else}
					<AuditLogListPage
						{orgName}
						{navGroups}
						{rows}
						bind:filters
						{onApplyFilters}
						{onClearFilters}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="audit-log-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening the audit log.
		</p>
	</div>
{/if}
