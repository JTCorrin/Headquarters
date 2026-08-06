<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		emptyMeetingFormData,
		membershipFromCreateResult,
		roleFromMemberships,
		toMeetingCreateBody,
		toMeetingFormData,
		toMeetingListItem,
		toMeetingUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiMeetingRelatedEntityType } from '$lib/api/v1/types.js';
	import type { EntityListFilter } from '$lib/crm/entity-list-filter.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import { meetingFormSchema, type MeetingListItem } from '$lib/schemas/meeting.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import MeetingsListPage from './meetings-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface MeetingsPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Optional paired entity list filter (`entity_type` + `entity_id`). */
		entityFilter?: EntityListFilter<ApiMeetingRelatedEntityType> | null;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onCreated?: (meetingId: string) => void;
		onClearEntityFilter?: () => void;
		onOpenCalendar?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		entityFilter = null,
		onMissingOrg,
		onSwitchNavigate,
		onCreated,
		onClearEntityFilter,
		onOpenCalendar,
		onLogout,
		class: className
	}: MeetingsPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<MeetingListItem[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let drawerOpen = $state(false);
	let editDrawerOpen = $state(false);
	let editingMeetingId = $state<string | null>(null);
	let editingMeetingVersion = $state<number | null>(null);

	const meetingForm = superForm(defaults(emptyMeetingFormData(), zod4(meetingFormSchema)), {
		validators: zod4(meetingFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

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
	const entityFilterLabel = $derived(
		entityFilter
			? `Filtered by ${entityFilter.entity_type} · ${entityFilter.entity_id.slice(0, 8)}…`
			: null
	);

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
		entityKey: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		entityKey: ''
	};

	function entityKey(
		filter: EntityListFilter<ApiMeetingRelatedEntityType> | null | undefined
	): string {
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
		rows = [];
		drawerOpen = false;
		editDrawerOpen = false;
		editingMeetingId = null;
		editingMeetingVersion = null;
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
				message: 'Select an organisation before opening meetings.'
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
				limit: 50,
				...(entityFilter
					? { entity_type: entityFilter.entity_type, entity_id: entityFilter.entity_id }
					: {})
			});
			if (isStale(epoch)) return;

			rows = listed.data.map(toMeetingListItem);
			viewState =
				rows.length === 0
					? {
							kind: 'empty',
							message: entityFilter
								? 'No meetings for this entity.'
								: 'No meetings yet — schedule your first meeting.'
						}
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load meetings.')
			};
		}
	}

	async function onCreateMeeting(): Promise<boolean> {
		const epoch = captureEpoch();
		try {
			const created = await api.meetings.create(toMeetingCreateBody(get(meetingForm.form)));
			if (isStale(epoch)) return false;
			rows = [toMeetingListItem(created), ...rows];
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

	async function openEditMeeting(id: string) {
		const epoch = captureEpoch();
		try {
			const result = await api.meetings.get(id);
			if (isStale(epoch)) return;
			editingMeetingId = id;
			editingMeetingVersion = result.data.version;
			editMeetingForm.form.set(toMeetingFormData(result.data));
			editDrawerOpen = true;
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load meeting — try again.')
			};
		}
	}

	async function onEditMeeting(): Promise<boolean> {
		const meetingId = editingMeetingId;
		const version = editingMeetingVersion;
		if (!meetingId || version == null) return false;

		const epoch = captureEpoch();
		try {
			const updated = await api.meetings.update(
				meetingId,
				toMeetingUpdateBody(get(editMeetingForm.form)),
				version
			);
			if (isStale(epoch)) return false;
			rows = rows.map((row) => (row.id === meetingId ? toMeetingListItem(updated) : row));
			editDrawerOpen = false;
			editingMeetingId = null;
			editingMeetingVersion = null;
			viewState = { kind: 'ready' };
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
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save meeting — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onDeleteMeeting(id: string) {
		const existing = rows.find((row) => row.id === id);
		if (!existing) return;
		if (!window.confirm('Delete this meeting? This cannot be undone.')) return;

		const epoch = captureEpoch();
		try {
			await api.meetings.delete(id, existing.version);
			if (isStale(epoch)) return;
			rows = rows.filter((row) => row.id !== id);
			viewState =
				rows.length === 0
					? { kind: 'empty', message: 'No meetings yet — schedule your first meeting.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Meeting changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not delete meeting — try again.')
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
	<div class={className} data-testid="meetings-page">
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
				<MeetingsListPage
					{orgName}
					{navGroups}
					{rows}
					form={meetingForm}
					{api}
					editForm={editMeetingForm}
					filterLabel={entityFilterLabel}
					onClearFilter={entityFilter ? onClearEntityFilter : undefined}
					bind:drawerOpen
					bind:editDrawerOpen
					onValidSubmit={onCreateMeeting}
					onValidEdit={onEditMeeting}
					onEditMeeting={openEditMeeting}
					onDeleteMeeting={onDeleteMeeting}
					{onOpenCalendar}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="meetings-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening meetings.
		</p>
	</div>
{/if}
