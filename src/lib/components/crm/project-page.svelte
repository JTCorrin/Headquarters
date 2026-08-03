<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		projectStatusLabel,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toWorkspaceCard,
		toWorkspaceCards,
		workspaceColumnsFromProject
	} from '$lib/api/v1/mappers.js';
	import type { ApiProjectDocument } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { ProjectCardBoardMove, ProjectWorkCard } from './project-workspace-board.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import ProjectWorkspacePage from './project-workspace-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ProjectPageProps {
		api: ApiV1Client;
		session: OrgSession;
		projectId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		projectId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: ProjectPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let project = $state<ApiProjectDocument | null>(null);
	let workCards = $state<ProjectWorkCard[]>([]);
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
	const navGroups = $derived(appNavGroups('Projects', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const projectName = $derived(project?.name ?? 'Project');
	const clientName = $derived(project?.client_label?.trim() || 'Client');
	const clientHref = $derived(project ? `/clients/${project.client_id}` : undefined);
	const status = $derived(project ? projectStatusLabel(project.status) : 'Planning');
	const columns = $derived(project ? workspaceColumnsFromProject(project) : []);

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isPreconditionFailed) {
				return error.message || 'Card changed elsewhere — reload and try again.';
			}
			if (error.status === 404 || error.code === 'NOT_FOUND') {
				return error.message || 'Project not found.';
			}
			return error.message || fallback;
		}
		return fallback;
	}

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		projectId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		projectId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.projectId = projectId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			projectId: liveEpoch.projectId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.projectId !== liveEpoch.projectId
		);
	}

	function resetOrgScopedState() {
		project = null;
		workCards = [];
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening projects.'
			};
			return;
		}
		if (!projectId) {
			viewState = { kind: 'validation', message: 'Missing project id.' };
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

			const result = await api.projects.get(projectId);
			if (isStale(epoch)) return;
			project = result.data;
			workCards = toWorkspaceCards(result.data);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			project = null;
			workCards = [];
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			if (
				isApiClientError(error) &&
				(error.status === 404 || error.code === 'NOT_FOUND')
			) {
				viewState = { kind: 'validation', message: userMessage(error, 'Project not found.') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load project.')
			};
		}
	}

	async function onMoveCard(move: ProjectCardBoardMove) {
		const existing = workCards.find((card) => card.id === move.id);
		if (!existing || !project) return;
		const previous = workCards;
		workCards = workCards.map((card) =>
			card.id === move.id
				? { ...card, column: move.columnId, position: move.position }
				: card
		);
		const epoch = captureEpoch();
		try {
			const updated = await api.projects.updateCard(
				project.id,
				move.id,
				{ column_id: move.columnId, position: move.position },
				existing.version ?? 1
			);
			if (isStale(epoch)) return;
			workCards = workCards.map((card) =>
				card.id === move.id ? toWorkspaceCard(updated) : card
			);
		} catch (error) {
			if (isStale(epoch)) return;
			workCards = previous;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Card version does not match If-Match.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not move card — try again.')
			};
		}
	}

	async function onAddCard() {
		if (!project) return;
		const backlog =
			project.columns.find((c) => c.key === 'backlog') ?? project.columns[0];
		if (!backlog) return;
		const epoch = captureEpoch();
		try {
			const created = await api.projects.createCard(project.id, {
				title: 'New card',
				column_id: backlog.id
			});
			if (isStale(epoch)) return;
			workCards = [...workCards, toWorkspaceCard(created)];
			if (viewState.kind !== 'ready') viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not add card — try again.')
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
		void projectId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="project-page">
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
				{/if}
				{#if viewState.kind === 'ready' && project}
					<ProjectWorkspacePage
						{orgName}
						{navGroups}
						{projectName}
						{clientName}
						{clientHref}
						{status}
						description={project.description ?? undefined}
						cards={workCards}
						{columns}
						{onMoveCard}
						{onAddCard}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="project-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening projects.
		</p>
	</div>
{/if}
