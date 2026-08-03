<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		isTaskDueBeforeToday,
		membershipFromCreateResult,
		roleFromMemberships,
		toDashboardMeeting,
		toDashboardTask,
		toMeetingListItem,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toTaskListItem
	} from '$lib/api/v1/mappers.js';
	import type { ApiOrganisationMembership } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { TaskListItem } from '$lib/schemas/task.js';
	import type { MeetingListItem } from '$lib/schemas/meeting.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import DashboardPage, {
		type DashboardAttentionItem,
		type DashboardMeeting,
		type DashboardStat
	} from './dashboard-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';
	import type { TimelineEvent } from './timeline.svelte';

	export interface DashboardHomePageProps {
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
	}: DashboardHomePageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let tasks = $state<TaskListItem[]>([]);
	let upcomingMeetingItems = $state<MeetingListItem[]>([]);
	let currentMembershipId = $state<string | null>(null);
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
	const navGroups = $derived(appNavGroups('Dashboard', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	const myTasks = $derived(tasks.map(toDashboardTask));
	const upcomingMeetings = $derived.by((): DashboardMeeting[] =>
		upcomingMeetingItems.map(toDashboardMeeting)
	);
	const openTasks = $derived(
		tasks.filter((t) => t.rawStatus !== 'done' && t.rawStatus !== 'cancelled')
	);
	const overdueTasks = $derived(openTasks.filter((t) => isTaskDueBeforeToday(t.dueAt)));

	const stats = $derived.by((): DashboardStat[] => {
		const open = openTasks.length;
		const overdue = overdueTasks.length;
		const done = tasks.filter((t) => t.rawStatus === 'done').length;
		return [
			{ label: 'My open tasks', value: String(open), hint: 'Assigned to you' },
			{
				label: 'Overdue',
				value: String(overdue),
				hint: overdue ? 'Needs a nudge' : 'None past due'
			},
			{ label: 'Completed (loaded)', value: String(done), hint: 'In this list' },
			{
				label: 'Assigned to me',
				value: String(tasks.length),
				hint: 'Open + done in view'
			}
		];
	});

	const attentionItems = $derived.by((): DashboardAttentionItem[] =>
		overdueTasks.slice(0, 5).map((task) => ({
			id: task.id,
			label: task.title,
			detail: `${task.relatedTo === '—' ? 'Task' : task.relatedTo} · due ${task.dueOn}`,
			tone: 'warn' as const
		}))
	);

	const recentActivity = $derived.by((): TimelineEvent[] => []);

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
		tasks = [];
		upcomingMeetingItems = [];
		currentMembershipId = null;
		viewState = { kind: 'loading' };
	}

	function syncMembershipId(rows: ApiOrganisationMembership[]) {
		const current = rows.find((row) => row.organisation.id === session.selectedOrgId);
		currentMembershipId = current?.membership.id ?? null;
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening the dashboard.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			const membershipRows = await api.organisations.list();
			if (isStale(epoch)) return;
			if (session.memberships.length === 0) {
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}
			syncMembershipId(membershipRows);

			const listed = await api.tasks.list({ limit: 50, assignee: 'me' });
			if (isStale(epoch)) return;

			tasks = listed.data.map((task) =>
				toTaskListItem(task, { currentMembershipId })
			);

			try {
				const upcoming = await api.meetings.list({ limit: 5, upcoming: true });
				if (isStale(epoch)) return;
				upcomingMeetingItems = upcoming.data.map(toMeetingListItem);
			} catch {
				if (isStale(epoch)) return;
				// Meetings API may land after this FE cut — keep Home usable.
				upcomingMeetingItems = [];
			}
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load dashboard.')
			};
		}
	}

	async function onToggleTask(id: string) {
		const existing = tasks.find((row) => row.id === id);
		if (!existing) return;

		const nextStatus = existing.rawStatus === 'done' ? 'open' : 'done';
		const epoch = captureEpoch();
		try {
			const updated = await api.tasks.update(id, { status: nextStatus }, existing.version);
			if (isStale(epoch)) return;
			tasks = tasks.map((row) =>
				row.id === id ? toTaskListItem(updated, { currentMembershipId }) : row
			);
			if (viewState.kind !== 'ready') viewState = { kind: 'ready' };
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

	function onSelectTask(id: string) {
		void goto(`/tasks?edit=${encodeURIComponent(id)}`);
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
	<div class={className} data-testid="dashboard-home-page">
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
				{#if viewState.kind === 'ready' || tasks.length > 0}
					<DashboardPage
						{orgName}
						{navGroups}
						{stats}
						{myTasks}
						{attentionItems}
						{upcomingMeetings}
						{recentActivity}
						{onToggleTask}
						{onSelectTask}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="dashboard-home-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening the dashboard.
		</p>
	</div>
{/if}
