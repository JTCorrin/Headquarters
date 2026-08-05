<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		canGenerateMeetingSummary,
		emptyMeetingFormData,
		formatMeetingWhen,
		meetingStatusLabel,
		meetingSummaryStatusLabel,
		meetingTranscriptPlainText,
		meetingTranscriptStatusLabel,
		membershipFromCreateResult,
		roleFromMemberships,
		toAttendeeFields,
		toMeetingFormData,
		toMeetingUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toProposedMeetingTasks
	} from '$lib/api/v1/mappers.js';
	import type { ApiMeetingDocument } from '$lib/api/v1/types.js';
	import { attachMeetingTranscriptFile } from '$lib/crm/meeting-transcript-attachment.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { meetingFormSchema } from '$lib/schemas/meeting.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { InfoCardField } from './info-card.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import MeetingFormDrawer from './meeting-form-drawer.svelte';
	import MeetingWorkspacePage from './meeting-workspace-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface MeetingPageProps {
		api: ApiV1Client;
		session: OrgSession;
		meetingId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onDeleted?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		meetingId,
		onMissingOrg,
		onSwitchNavigate,
		onDeleted,
		onLogout,
		class: className
	}: MeetingPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let meeting = $state<ApiMeetingDocument | null>(null);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let busy = $state(false);
	let actionBusy = $state(false);
	let editDrawerOpen = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	const editMeetingForm = superForm(defaults(emptyMeetingFormData(), zod4(meetingFormSchema)), {
		validators: zod4(meetingFormSchema),
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
		if (meeting.calendar_provider?.trim()) {
			const provider = meeting.calendar_provider.trim().toLowerCase();
			const label =
				provider === 'google'
					? 'Google'
					: provider === 'microsoft'
						? 'Microsoft'
						: provider === 'caldav'
							? 'CalDAV'
							: meeting.calendar_provider.trim();
			fields.push({ label: 'Calendar', value: `Linked · ${label}` });
		}
		fields.push({ label: 'Related', value: relatedTo });
		return fields;
	});
	const attendeeFields = $derived.by((): InfoCardField[] =>
		toAttendeeFields(meeting?.attendees ?? [])
	);
	const transcript = $derived(meeting ? meetingTranscriptPlainText(meeting) : '');
	const summary = $derived(meeting?.summary?.trim() || '');
	const proposedTasks = $derived(toProposedMeetingTasks(meeting?.task_proposals));
	const transcriptStatusLabel = $derived(
		meeting ? meetingTranscriptStatusLabel(meeting.transcript_status) : 'Missing'
	);
	const summaryStatusLabel = $derived(
		meeting && meeting.summary_status !== 'none'
			? meetingSummaryStatusLabel(meeting.summary_status)
			: summary
				? 'Ready'
				: undefined
	);
	const generateEnabled = $derived(meeting ? canGenerateMeetingSummary(meeting) : false);

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') {
				return error.message || 'Meeting not found.';
			}
			return error.message || fallback;
		}
		if (error instanceof Error && error.message) return error.message;
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
		actionError = null;
		editDrawerOpen = false;
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

	function onUploadTranscript() {
		actionError = null;
		fileInput?.click();
	}

	async function onTranscriptFileSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !meeting) return;

		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			const next = await attachMeetingTranscriptFile(api, meeting, file);
			if (isStale(epoch)) return;
			meeting = next;
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Could not attach transcript — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
		}
	}

	async function onGenerateSummary() {
		if (!meeting || !canGenerateMeetingSummary(meeting)) return;
		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			const next = await api.meetings.generateSummary(meeting.id, meeting.version);
			if (isStale(epoch)) return;
			meeting = next;
			if (next.summary_status === 'failed') {
				actionError = 'Summary generation failed — check the transcript and retry.';
			}
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Could not generate summary — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
		}
	}

	async function onAcceptTask(proposalId: string) {
		if (!meeting) return;
		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			const next = await api.meetings.acceptTaskProposal(
				meeting.id,
				proposalId,
				meeting.version
			);
			if (isStale(epoch)) return;
			meeting = next;
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Could not accept proposal — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
		}
	}

	async function onDismissTask(proposalId: string) {
		if (!meeting) return;
		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			const next = await api.meetings.dismissTaskProposal(
				meeting.id,
				proposalId,
				meeting.version
			);
			if (isStale(epoch)) return;
			meeting = next;
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Could not dismiss proposal — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
		}
	}

	function onEdit() {
		if (!meeting) return;
		editMeetingForm.form.set(toMeetingFormData(meeting));
		actionError = null;
		editDrawerOpen = true;
	}

	async function onValidEdit(): Promise<boolean> {
		if (!meeting) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.meetings.update(
				meeting.id,
				toMeetingUpdateBody(get(editMeetingForm.form)),
				meeting.version
			);
			if (isStale(epoch)) return false;
			meeting = updated;
			editDrawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Meeting changed elsewhere — reload and try again.')
				};
				return false;
			}
			actionError = userMessage(error, 'Could not save meeting — try again.');
			return false;
		}
	}

	async function onDelete() {
		if (!meeting) return;
		if (!window.confirm('Delete this meeting? This cannot be undone.')) return;
		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			await api.meetings.delete(meeting.id, meeting.version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Meeting changed elsewhere — reload and try again.')
				};
				return;
			}
			actionError = userMessage(error, 'Could not delete meeting — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
		}
	}

	async function onAcceptAllTasks() {
		if (!meeting) return;
		const open = (meeting.task_proposals ?? []).filter((p) => p.status === 'proposed');
		if (open.length === 0) return;

		const epoch = captureEpoch();
		actionBusy = true;
		actionError = null;
		try {
			let current = meeting;
			for (const proposal of open) {
				current = await api.meetings.acceptTaskProposal(
					current.id,
					proposal.id,
					current.version
				);
				if (isStale(epoch)) return;
			}
			meeting = current;
		} catch (error) {
			if (isStale(epoch)) return;
			actionError = userMessage(error, 'Could not accept all proposals — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
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
		<input
			bind:this={fileInput}
			type="file"
			class="sr-only"
			accept=".txt,.md,.markdown,.vtt,.pdf,text/plain,text/markdown,text/vtt,application/pdf"
			data-testid="meeting-transcript-file"
			onchange={onTranscriptFileSelected}
		/>
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
						{transcript}
						{transcriptStatusLabel}
						{summary}
						{summaryStatusLabel}
						{proposedTasks}
						{actionError}
						{actionBusy}
						{generateEnabled}
						showNav={false}
						{onUploadTranscript}
						{onGenerateSummary}
						{onAcceptTask}
						{onDismissTask}
						{onAcceptAllTasks}
						{onEdit}
						{onDelete}
						class="min-h-0 flex-1"
					/>
					<MeetingFormDrawer
						bind:open={editDrawerOpen}
						form={editMeetingForm}
						showTrigger={false}
						title="Edit meeting"
						description="Update schedule, related record, or attendees. Changes use If-Match versioning."
						submitLabel="Save changes"
						onValidSubmit={onValidEdit}
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
