<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { CalendarDate } from '@internationalized/date';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		emptyMeetingFormData,
		membershipFromCreateResult,
		roleFromMemberships,
		toMeetingCreateBody,
		toMeetingListItem,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import {
		currentCalendarMonth,
		meetingFormPrefillForDay,
		visibleMonthGrid
	} from '$lib/crm/meeting-calendar-range.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import { meetingFormSchema, type MeetingListItem } from '$lib/schemas/meeting.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import MeetingsCalendarView from './meetings-calendar-view.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface MeetingsCalendarPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onCreated?: (meetingId: string) => void;
		onOpenMeeting?: (meetingId: string) => void;
		onOpenList?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onCreated,
		onOpenMeeting,
		onOpenList,
		onLogout,
		class: className
	}: MeetingsCalendarPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<MeetingListItem[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);
	let month = $state<CalendarDate>(currentCalendarMonth());

	const meetingForm = superForm(defaults(emptyMeetingFormData(), zod4(meetingFormSchema)), {
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
	const grid = $derived(visibleMonthGrid(month));

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
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
		rangeKey: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		rangeKey: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.rangeKey = `${grid.startsAfter}|${grid.startsBefore}`;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			rangeKey: liveEpoch.rangeKey
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.rangeKey !== liveEpoch.rangeKey
		);
	}

	function resetOrgScopedState() {
		rows = [];
		drawerOpen = false;
		viewState = { kind: 'loading' };
	}

	function resetCreateForm() {
		meetingForm.form.set(emptyMeetingFormData());
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening the calendar.'
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

			const listed = await api.meetings.list({
				limit: 100,
				starts_after: grid.startsAfter,
				starts_before: grid.startsBefore
			});
			if (isStale(epoch)) return;

			rows = listed.data.map(toMeetingListItem);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load calendar meetings.')
			};
		}
	}

	async function onCreateMeeting(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.meetings.create(toMeetingCreateBody(get(meetingForm.form)));
			if (isStale(epoch)) return false;
			rows = [...rows, toMeetingListItem(created)].sort((a, b) =>
				a.startsAt.localeCompare(b.startsAt)
			);
			viewState = { kind: 'ready' };
			resetCreateForm();
			drawerOpen = false;
			onCreated?.(created.id);
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create meeting — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	function openScheduleForDay(day: CalendarDate) {
		meetingForm.form.set(meetingFormPrefillForDay(day));
		drawerOpen = true;
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
		void grid.startsAfter;
		void grid.startsBefore;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="meetings-calendar-page">
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
				<MeetingsCalendarView
					{orgName}
					{navGroups}
					{month}
					days={grid.days}
					meetings={rows}
					form={meetingForm}
					{api}
					bind:drawerOpen
					onPrevMonth={() => {
						month = month.subtract({ months: 1 });
					}}
					onNextMonth={() => {
						month = month.add({ months: 1 });
					}}
					onSelectDay={openScheduleForDay}
					onSelectMeeting={onOpenMeeting}
					onValidSubmit={onCreateMeeting}
					{onOpenList}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="meetings-calendar-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening the calendar.
		</p>
	</div>
{/if}
