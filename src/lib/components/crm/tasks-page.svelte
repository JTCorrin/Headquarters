<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		assigneeOptionsFromMemberships,
		emptyTaskFormData,
		membershipFromCreateResult,
		roleFromMemberships,
		toDashboardTask,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toTaskBoardCard,
		toTaskCreateBody,
		toTaskFormData,
		toTaskListItem,
		toTaskUpdateBody
	} from '$lib/api/v1/mappers.js';
	import type { ApiOrganisationMembership, ApiTaskEntityType } from '$lib/api/v1/types.js';
	import type { EntityListFilter } from '$lib/crm/entity-list-filter.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		taskFormSchema,
		type TaskAssigneeOption,
		type TaskListItem
	} from '$lib/schemas/task.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import TasksListPage, { type TasksViewMode } from './tasks-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface TasksPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** When set, open the edit drawer for this task after load. */
		initialEditTaskId?: string | null;
		/** Optional paired entity list filter (`entity_type` + `entity_id`). */
		entityFilter?: EntityListFilter<ApiTaskEntityType> | null;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onClearEntityFilter?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		initialEditTaskId = null,
		entityFilter = null,
		onMissingOrg,
		onSwitchNavigate,
		onClearEntityFilter,
		onLogout,
		class: className
	}: TasksPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let tasks = $state<TaskListItem[]>([]);
	let assigneeOptions = $state<TaskAssigneeOption[]>([]);
	let currentMembershipId = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);
	let editDrawerOpen = $state(false);
	let editingTaskId = $state<string | null>(null);
	let viewMode = $state<TasksViewMode>('list');

	const taskForm = superForm(defaults(emptyTaskFormData(), zod4(taskFormSchema)), {
		validators: zod4(taskFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const editTaskForm = superForm(defaults(emptyTaskFormData(), zod4(taskFormSchema)), {
		validators: zod4(taskFormSchema),
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
	const navGroups = $derived(appNavGroups('Tasks', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const listTasks = $derived(tasks.map(toDashboardTask));
	const boardTasks = $derived(tasks.map(toTaskBoardCard));
	const entityFilterLabel = $derived(
		entityFilter
			? `Filtered by ${entityFilter.entity_type} · ${entityFilter.entity_id.slice(0, 8)}…`
			: null
	);
	let pendingEditTaskId = $state<string | null>(null);

	$effect(() => {
		pendingEditTaskId = initialEditTaskId;
	});

	function listItemOptions() {
		return {
			currentMembershipId,
			assigneeOptions
		};
	}

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isPreconditionFailed) {
				return error.message || 'Task changed elsewhere — reload and try again.';
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
		entityKey: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		entityKey: ''
	};

	function entityKey(filter: EntityListFilter<ApiTaskEntityType> | null | undefined): string {
		return filter ? `${filter.entity_type}:${filter.entity_id}` : '';
	}

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.entityKey = entityKey(entityFilter);
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			entityKey: liveEpoch.entityKey
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.entityKey !== liveEpoch.entityKey
		);
	}

	function resetOrgScopedState() {
		tasks = [];
		assigneeOptions = [];
		currentMembershipId = null;
		drawerOpen = false;
		editDrawerOpen = false;
		editingTaskId = null;
		viewState = { kind: 'loading' };
	}

	function syncAssigneeContext(rows: ApiOrganisationMembership[]) {
		assigneeOptions = assigneeOptionsFromMemberships(rows, session.selectedOrgId);
		const current = rows.find((row) => row.organisation.id === session.selectedOrgId);
		currentMembershipId = current?.membership.id ?? null;
	}

	function resetCreateForm() {
		taskForm.form.set(emptyTaskFormData());
	}

	function openEdit(taskId: string) {
		const task = tasks.find((row) => row.id === taskId);
		if (!task) return;
		editingTaskId = task.id;
		editTaskForm.form.set(toTaskFormData(task));
		editDrawerOpen = true;
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening tasks.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			let membershipRows: ApiOrganisationMembership[] = [];
			if (session.memberships.length === 0) {
				membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			} else {
				membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
			}

			syncAssigneeContext(membershipRows);

			const listed = await api.tasks.list({
				limit: 100,
				...(entityFilter
					? { entity_type: entityFilter.entity_type, entity_id: entityFilter.entity_id }
					: {})
			});
			if (isStale(epoch)) return;

			tasks = listed.data.map((task) => toTaskListItem(task, listItemOptions()));
			viewState =
				tasks.length === 0
					? {
							kind: 'empty',
							message: entityFilter
								? 'No tasks for this entity.'
								: 'No tasks yet — create your first task.'
						}
					: { kind: 'ready' };

			const editId = pendingEditTaskId;
			if (editId && tasks.some((row) => row.id === editId)) {
				pendingEditTaskId = null;
				openEdit(editId);
			}
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load tasks.')
			};
		}
	}

	async function onCreateTask(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.tasks.create(toTaskCreateBody(get(taskForm.form)));
			if (isStale(epoch)) return false;
			tasks = [toTaskListItem(created, listItemOptions()), ...tasks];
			viewState = { kind: 'ready' };
			resetCreateForm();
			drawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create task — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onEditTask(): Promise<boolean> {
		const taskId = editingTaskId;
		if (!taskId) return false;
		const existing = tasks.find((row) => row.id === taskId);
		if (!existing) return false;

		const epoch = captureEpoch();
		try {
			const updated = await api.tasks.update(
				taskId,
				toTaskUpdateBody(get(editTaskForm.form)),
				existing.version
			);
			if (isStale(epoch)) return false;
			tasks = tasks.map((row) =>
				row.id === taskId ? toTaskListItem(updated, listItemOptions()) : row
			);
			editDrawerOpen = false;
			editingTaskId = null;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Task version does not match If-Match.')
				};
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save task — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onToggleDone(taskId: string) {
		const existing = tasks.find((row) => row.id === taskId);
		if (!existing) return;

		const nextStatus = existing.rawStatus === 'done' ? 'open' : 'done';
		const epoch = captureEpoch();
		try {
			const updated = await api.tasks.update(taskId, { status: nextStatus }, existing.version);
			if (isStale(epoch)) return;
			tasks = tasks.map((row) =>
				row.id === taskId ? toTaskListItem(updated, listItemOptions()) : row
			);
			viewState = tasks.length === 0 ? { kind: 'empty', message: 'No tasks yet.' } : { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Task version does not match If-Match.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not update task — try again.')
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
		void entityFilter?.entity_type;
		void entityFilter?.entity_id;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="tasks-page">
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
				<TasksListPage
					{orgName}
					{navGroups}
					{listTasks}
					{boardTasks}
					{viewMode}
					form={taskForm}
					editForm={editTaskForm}
					{assigneeOptions}
					filterLabel={entityFilterLabel}
					onClearFilter={entityFilter ? onClearEntityFilter : undefined}
					bind:drawerOpen
					bind:editDrawerOpen
					onValidSubmit={onCreateTask}
					onValidEdit={onEditTask}
					onEditTask={openEdit}
					{onToggleDone}
					onViewModeChange={(mode) => {
						viewMode = mode;
					}}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="tasks-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening tasks.
		</p>
	</div>
{/if}
