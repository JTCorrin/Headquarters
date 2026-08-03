<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		formatMeetingWhen,
		meetingStatusLabel,
		membershipFromCreateResult,
		roleFromMemberships,
		toAttendeeFields,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiMeetingDocument } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { InfoCardField } from './info-card.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import MeetingWorkspacePage from './meeting-workspace-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface MeetingPageProps {
		api: ApiV1Client;
		session: OrgSession;
		meetingId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		meetingId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: MeetingPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let meeting = $state<ApiMeetingDocument | null>(null);
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
	const navGroups = $derived(appNavGroups('Meetings', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	const title = $derived(meeting?.title ?? 'Meeting');
	const status = $derived(meeting ? meetingStatusLabel(meeting.status) : 'Scheduled');
	const when = $derived(
		meeting ? formatMeetingWhen(meeting.starts_at, meeting.ends_at, meeting.timezone) : '—'
	);
	const relatedTo = $derived(
		meeting?.related_entity_label?.trim() ||
			meeting?.related_entity_type ||
			'No related record'
	);
	const scheduleFields = $derived.by((): InfoCardField[] => {
		if (!meeting) return [];
		const fields: InfoCardField[] = [
			{ label: 'When', value: when },
			{ label: 'Timezone', value: meeting.timezone || '—' }
		];
		if (meeting.location?.trim()) {
			fields.push({ label: 'Location', value: meeting.location.trim() });
		}
		if (meeting.meeting_url?.trim()) {
			fields.push({ label: 'Meeting URL', value: meeting.meeting_url.trim() });
		}
		fields.push({ label: 'Related', value: relatedTo });
		return fields;
	});
	const attendeeFields = $derived.by((): InfoCardField[] =>
		toAttendeeFields(meeting?.attendees ?? [])
	);

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') {
				return error.message || 'Meeting not found.';
			}
			return error.message || fallback;
		}
		return fallback;
	}

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		meetingId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		meetingId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.meetingId = meetingId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			meetingId: liveEpoch.meetingId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.meetingId !== liveEpoch.meetingId
		);
	}

	function resetOrgScopedState() {
		meeting = null;
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening meetings.'
			};
			return;
		}
		if (!meetingId) {
			viewState = { kind: 'validation', message: 'Missing meeting id.' };
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

			const result = await api.meetings.get(meetingId);
			if (isStale(epoch)) return;
			meeting = result.data;
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			meeting = null;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			if (
				isApiClientError(error) &&
				(error.status === 404 || error.code === 'NOT_FOUND')
			) {
				viewState = { kind: 'validation', message: userMessage(error, 'Meeting not found.') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load meeting.')
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
		void meetingId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="meeting-page">
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
				{#if viewState.kind === 'ready' && meeting}
					<MeetingWorkspacePage
						{orgName}
						{navGroups}
						{title}
						{status}
						{when}
						{relatedTo}
						{scheduleFields}
						{attendeeFields}
						transcript=""
						summary=""
						proposedTasks={[]}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="meeting-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening meetings.
		</p>
	</div>
{/if}
