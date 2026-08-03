<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		emptyProjectFormData,
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toProjectBoardCard,
		toProjectCreateBody,
		toProjectListItem
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import { projectFormSchema, type ProjectListItem } from '$lib/schemas/project.js';
	import type { ProjectBoardMove } from './projects-board.svelte';
	import type { ProjectClientOption } from './project-form.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import ProjectsBoardPage from './projects-board-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface ProjectsPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onSelectProject?: (projectId: string) => void;
		onCreated?: (projectId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onSelectProject,
		onCreated,
		onLogout,
		class: className
	}: ProjectsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<ProjectListItem[]>([]);
	let clients = $state<ProjectClientOption[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);

	const projectForm = superForm(defaults(emptyProjectFormData(), zod4(projectFormSchema)), {
		validators: zod4(projectFormSchema),
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
	const boardProjects = $derived(rows.map(toProjectBoardCard));

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isPreconditionFailed) {
				return error.message || 'Project changed elsewhere — reload and try again.';
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
		clients = [];
		drawerOpen = false;
		viewState = { kind: 'loading' };
	}

	function resetCreateForm() {
		const next = emptyProjectFormData();
		if (clients[0]) next.clientId = clients[0].id;
		projectForm.form.set(next);
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

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const [listed, clientRows] = await Promise.all([
				api.projects.list({ limit: 100 }),
				api.clients.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			rows = listed.data
				.filter((p) => p.status !== 'archived')
				.map(toProjectListItem);
			clients = clientRows.data.map((c) => ({ id: c.id, name: c.name }));
			const currentForm = get(projectForm.form);
			if (!currentForm.clientId && clients[0]) {
				projectForm.form.set({ ...currentForm, clientId: clients[0].id });
			}
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No projects yet — create one attached to a client.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load projects.')
			};
		}
	}

	async function onCreateProject(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.projects.create(toProjectCreateBody(get(projectForm.form)));
			if (isStale(epoch)) return false;
			rows = [toProjectListItem(created), ...rows];
			viewState = { kind: 'ready' };
			resetCreateForm();
			drawerOpen = false;
			onCreated?.(created.id);
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create project — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onMoveProject(move: ProjectBoardMove) {
		const existing = rows.find((row) => row.id === move.id);
		if (!existing) return;
		const previous = rows;
		rows = rows.map((row) =>
			row.id === move.id
				? { ...row, stage: move.status, position: move.position, rawStatus: move.status }
				: row
		);
		const epoch = captureEpoch();
		try {
			const updated = await api.projects.update(
				move.id,
				{ status: move.status, position: move.position },
				existing.version
			);
			if (isStale(epoch)) return;
			rows = rows.map((row) =>
				row.id === move.id ? toProjectListItem(updated) : row
			);
		} catch (error) {
			if (isStale(epoch)) return;
			rows = previous;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Project version does not match If-Match.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not move project — try again.')
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
	<div class={className} data-testid="projects-page">
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
				{#if viewState.kind !== 'ready' && viewState.kind !== 'empty'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{/if}
				<ProjectsBoardPage
					{orgName}
					{navGroups}
					projects={boardProjects}
					{clients}
					form={projectForm}
					bind:drawerOpen
					onSelectProject={onSelectProject}
					{onMoveProject}
					onValidSubmit={onCreateProject}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="projects-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening projects.
		</p>
	</div>
{/if}
