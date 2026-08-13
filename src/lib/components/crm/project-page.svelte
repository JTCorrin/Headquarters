<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		emptyProjectCardFormData,
		emptyProjectFormData,
		membershipFromCreateResult,
		projectStatusLabel,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toProjectCardCreateBody,
		toProjectCardFormData,
		toProjectCardUpdateBody,
		toProjectFormData,
		toProjectUpdateBody,
		toWorkspaceCard,
		toWorkspaceCards,
		workspaceColumnsFromProject
	} from '$lib/api/v1/mappers.js';
	import type { ApiProjectCard, ApiProjectDocument } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		projectCardFormSchema,
		projectFormSchema,
		projectClientDisplayName
	} from '$lib/schemas/project.js';
	import type { ProjectCardBoardMove, ProjectWorkCard } from './project-workspace-board.svelte';
	import type { ProjectClientOption } from './project-form.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import ProjectCardFormDrawer from './project-card-form-drawer.svelte';
	import ProjectFormDrawer from './project-form-drawer.svelte';
	import ProjectWorkspacePage from './project-workspace-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ProjectPageProps {
		api: ApiV1Client;
		session: OrgSession;
		projectId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onDeleted?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		projectId,
		onMissingOrg,
		onSwitchNavigate,
		onDeleted,
		onLogout,
		class: className
	}: ProjectPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let project = $state<ApiProjectDocument | null>(null);
	let workCards = $state<ProjectWorkCard[]>([]);
	let clients = $state<ProjectClientOption[]>([]);
	let cardDocuments = $state<Record<string, ApiProjectCard>>({});
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let busy = $state(false);
	let actionBusy = $state(false);
	let editDrawerOpen = $state(false);
	let cardDrawerOpen = $state(false);
	let cardDrawerMode = $state<'create' | 'edit'>('create');
	let editingCardId = $state<string | null>(null);

	const projectForm = superForm(defaults(emptyProjectFormData(), zod4(projectFormSchema)), {
		validators: zod4(projectFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const cardForm = superForm(defaults(emptyProjectCardFormData(), zod4(projectCardFormSchema)), {
		validators: zod4(projectCardFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

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
	const clientName = $derived(project ? projectClientDisplayName(project) : 'Client');
	const clientHref = $derived(
		project?.client_id ? `/clients/${project.client_id}` : undefined
	);
	const status = $derived(project ? projectStatusLabel(project.status) : 'Planning');
	const columns = $derived(project ? workspaceColumnsFromProject(project) : []);

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isPreconditionFailed) {
				return error.message || 'Changed elsewhere — reload and try again.';
			}
			if (error.status === 404 || error.code === 'NOT_FOUND') {
				return error.message || 'Project not found.';
			}
			if (error.isValidationError) {
				if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
				return error.message;
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

	function indexCards(doc: ApiProjectDocument) {
		const next: Record<string, ApiProjectCard> = {};
		for (const column of doc.columns ?? []) {
			for (const card of column.cards ?? []) {
				next[card.id] = card;
			}
		}
		cardDocuments = next;
	}

	function resetOrgScopedState() {
		project = null;
		workCards = [];
		clients = [];
		cardDocuments = {};
		actionError = null;
		editDrawerOpen = false;
		cardDrawerOpen = false;
		editingCardId = null;
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

			const [result, clientRows] = await Promise.all([
				api.projects.get(projectId),
				api.clients.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;
			project = result.data;
			workCards = toWorkspaceCards(result.data);
			indexCards(result.data);
			clients = clientRows.data.map((c) => ({ id: c.id, name: c.name }));
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
			cardDocuments = { ...cardDocuments, [updated.id]: updated };
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

	function onAddCard() {
		cardDrawerMode = 'create';
		editingCardId = null;
		cardForm.form.set(emptyProjectCardFormData());
		actionError = null;
		cardDrawerOpen = true;
	}

	function onSelectCard(id: string) {
		const doc = cardDocuments[id];
		if (!doc) return;
		cardDrawerMode = 'edit';
		editingCardId = id;
		cardForm.form.set(toProjectCardFormData(doc));
		actionError = null;
		cardDrawerOpen = true;
	}

	async function onValidCardSubmit(): Promise<boolean> {
		if (!project) return false;
		const epoch = captureEpoch();
		const body =
			cardDrawerMode === 'create'
				? toProjectCardCreateBody(get(cardForm.form))
				: toProjectCardUpdateBody(get(cardForm.form));

		try {
			if (cardDrawerMode === 'create') {
				const backlog =
					project.columns.find((c) => c.key === 'backlog') ?? project.columns[0];
				if (!backlog) return false;
				const created = await api.projects.createCard(project.id, {
					...body,
					column_id: backlog.id
				});
				if (isStale(epoch)) return false;
				workCards = [...workCards, toWorkspaceCard(created)];
				cardDocuments = { ...cardDocuments, [created.id]: created };
			} else {
				const cardId = editingCardId;
				const existing = cardId ? cardDocuments[cardId] : null;
				if (!cardId || !existing) return false;
				const updated = await api.projects.updateCard(
					project.id,
					cardId,
					body,
					existing.version
				);
				if (isStale(epoch)) return false;
				workCards = workCards.map((card) =>
					card.id === cardId ? toWorkspaceCard(updated) : card
				);
				cardDocuments = { ...cardDocuments, [updated.id]: updated };
			}
			cardDrawerOpen = false;
			editingCardId = null;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Card changed elsewhere — reload and try again.')
				};
				return false;
			}
			actionError = userMessage(error, 'Could not save card — try again.');
			return false;
		}
	}

	async function onDeleteCard() {
		if (!project || !editingCardId) return;
		const existing = cardDocuments[editingCardId];
		if (!existing) return;
		if (!window.confirm('Delete this card? This cannot be undone.')) return;

		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			await api.projects.deleteCard(project.id, editingCardId, existing.version);
			if (isStale(epoch)) return;
			workCards = workCards.filter((card) => card.id !== editingCardId);
			const next = { ...cardDocuments };
			delete next[editingCardId];
			cardDocuments = next;
			cardDrawerOpen = false;
			editingCardId = null;
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Card changed elsewhere — reload and try again.')
				};
				return;
			}
			actionError = userMessage(error, 'Could not delete card — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
		}
	}

	function onEdit() {
		if (!project) return;
		projectForm.form.set(toProjectFormData(project));
		actionError = null;
		editDrawerOpen = true;
	}

	async function onValidEdit(): Promise<boolean> {
		if (!project) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.projects.update(
				project.id,
				toProjectUpdateBody(get(projectForm.form)),
				project.version
			);
			if (isStale(epoch)) return false;
			project = updated;
			editDrawerOpen = false;
			if (updated.status === 'archived') {
				onDeleted?.();
			}
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Project changed elsewhere — reload and try again.')
				};
				return false;
			}
			actionError = userMessage(error, 'Could not save project — try again.');
			return false;
		}
	}

	async function onDelete() {
		if (!project) return;
		if (!window.confirm('Delete this project? This cannot be undone.')) return;
		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			await api.projects.delete(project.id, project.version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Project changed elsewhere — reload and try again.')
				};
				return;
			}
			actionError = userMessage(error, 'Could not delete project — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
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
				{#if actionError && viewState.kind === 'ready'}
					<div class="px-6 pt-4 md:px-8">
						<p class="text-destructive text-sm" role="alert">{actionError}</p>
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
						{actionBusy}
						{onMoveCard}
						{onAddCard}
						{onSelectCard}
						{onEdit}
						{onDelete}
						showNav={false}
						class="min-h-0 flex-1"
					/>
					<ProjectFormDrawer
						bind:open={editDrawerOpen}
						form={projectForm}
						{clients}
						showTrigger={false}
						allowArchived={true}
						title="Edit project"
						description="Update name, status (including archive), or whether this is internal or attached to a client. Uses If-Match."
						submitLabel="Save changes"
						onValidSubmit={onValidEdit}
					/>
					<ProjectCardFormDrawer
						bind:open={cardDrawerOpen}
						form={cardForm}
						title={cardDrawerMode === 'create' ? 'New card' : 'Edit card'}
						description={cardDrawerMode === 'create'
							? 'Cards land in Backlog — drag them across columns after save.'
							: 'Update title, description, or due date. Uses If-Match.'}
						submitLabel={cardDrawerMode === 'create' ? 'Create card' : 'Save changes'}
						onValidSubmit={onValidCardSubmit}
						onDelete={cardDrawerMode === 'edit' ? onDeleteCard : undefined}
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
