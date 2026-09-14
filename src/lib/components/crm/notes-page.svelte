<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import {
		noteToListItem,
		readStoredNotesViewMode,
		sortNoteItems,
		toNoteListItem,
		writeStoredNotesViewMode
	} from '$lib/crm/notes.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { NoteListItem, NotesViewMode } from '$lib/schemas/note.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import NotesListPage from './notes-list-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface NotesPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Storage for the persisted view-mode preference; defaults to localStorage. */
		storage?: Storage | null;
		/** Debounce for search-as-you-type against the API (ms). */
		searchDebounceMs?: number;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onCreated?: (noteId: string) => void;
		onOpenNote?: (noteId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		storage = typeof localStorage === 'undefined' ? null : localStorage,
		searchDebounceMs = 250,
		onMissingOrg,
		onSwitchNavigate,
		onCreated,
		onOpenNote,
		onLogout,
		class: className
	}: NotesPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let items = $state<NoteListItem[]>([]);
	let viewMode = $state<NotesViewMode>(untrack(() => readStoredNotesViewMode(storage)));
	let searchQuery = $state('');
	let activeQuery = $state('');
	let searching = $state(false);
	let creating = $state(false);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ?? 'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ?? 'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Notes', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		query: string;
	}

	const liveEpoch: RequestEpoch = { orgId: null, generation: -1, query: '' };

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.query = activeQuery;
	});

	function captureEpoch(): RequestEpoch {
		return { ...liveEpoch };
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.query !== liveEpoch.query
		);
	}

	function resetOrgScopedState() {
		items = [];
		searchQuery = '';
		activeQuery = '';
		viewState = { kind: 'loading' };
	}

	function emptyState(): ResourceViewState {
		return {
			kind: 'empty',
			message: activeQuery
				? `No notes match “${activeQuery}”.`
				: 'No notes yet — create your first note.'
		};
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = { kind: 'forbidden', message: 'Select an organisation before opening notes.' };
			return;
		}

		const epoch = captureEpoch();
		const isSearch = epoch.query.length > 0;
		if (isSearch) searching = true;
		else viewState = { kind: 'loading' };
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const listed = await api.notes.list({
				limit: 100,
				...(isSearch ? { q: epoch.query } : {})
			});
			if (isStale(epoch)) return;

			const now = new Date();
			items = sortNoteItems(listed.data.map((note) => toNoteListItem(note, now)));
			viewState = items.length === 0 ? emptyState() : { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = { kind: 'validation', message: userMessage(error, 'Could not load notes.') };
		} finally {
			if (!isStale(epoch)) searching = false;
		}
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	function onSearchChange(value: string) {
		searchQuery = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = null;
			activeQuery = value.trim();
		}, searchDebounceMs);
	}

	onDestroy(() => {
		if (searchTimer) clearTimeout(searchTimer);
	});

	function onViewModeChange(mode: NotesViewMode) {
		viewMode = mode;
		writeStoredNotesViewMode(storage, mode);
	}

	async function onCreateNote() {
		if (creating) return;
		creating = true;
		const epoch = captureEpoch();
		try {
			const created = await api.notes.create({});
			if (isStale(epoch)) return;
			items = sortNoteItems([noteToListItem(created), ...items]);
			viewState = { kind: 'ready' };
			onCreated?.(created.id);
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create note — try again.')
			};
		} finally {
			creating = false;
		}
	}

	async function onTogglePin(id: string) {
		const existing = items.find((item) => item.id === id);
		if (!existing) return;
		const epoch = captureEpoch();
		const nextPinned = !existing.pinned;
		// Optimistic flip; the response replaces the row with server truth (version, updated_at).
		items = sortNoteItems(
			items.map((item) => (item.id === id ? { ...item, pinned: nextPinned } : item))
		);
		try {
			const updated = await api.notes.update(id, { pinned: nextPinned }, existing.version);
			if (isStale(epoch)) return;
			items = sortNoteItems(items.map((item) => (item.id === id ? noteToListItem(updated) : item)));
		} catch (error) {
			if (isStale(epoch)) return;
			items = sortNoteItems(items.map((item) => (item.id === id ? existing : item)));
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Note changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not update note — try again.')
			};
		}
	}

	async function onDeleteNote(id: string) {
		const existing = items.find((item) => item.id === id);
		if (!existing) return;
		if (!window.confirm('Delete this note? This cannot be undone.')) return;

		const epoch = captureEpoch();
		try {
			await api.notes.delete(id, existing.version);
			if (isStale(epoch)) return;
			items = items.filter((item) => item.id !== id);
			viewState = items.length === 0 ? emptyState() : { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Note changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not delete note — try again.')
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
		void activeQuery;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="notes-page">
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
				<NotesListPage
					{orgName}
					{navGroups}
					{items}
					{viewMode}
					{searchQuery}
					{searching}
					{creating}
					{onViewModeChange}
					{onSearchChange}
					{onCreateNote}
					{onOpenNote}
					{onTogglePin}
					{onDeleteNote}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="notes-page">
		<p class="text-sm text-destructive" role="alert">
			Select an organisation before opening notes.
		</p>
	</div>
{/if}
