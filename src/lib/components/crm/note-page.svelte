<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiNote, ApiNoteDocument, ApiNoteUpdateBody } from '$lib/api/v1/types.js';
	import { createEditor, type Content } from '$lib/components/edra/shadcn/index.js';
	import { EMPTY_NOTE_DOCUMENT, toNoteBodyText, type NoteSaveStatus } from '$lib/crm/notes.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { NoteColor } from '$lib/schemas/note.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import NoteEditorPage from './note-editor-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface NotePageProps {
		api: ApiV1Client;
		session: OrgSession;
		noteId: string;
		/** Idle time before an autosave fires (ms). */
		autosaveDebounceMs?: number;
		/** How long the "Saved" indicator lingers before returning to idle (ms). */
		savedIndicatorMs?: number;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onBack?: () => void;
		onDeleted?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		noteId,
		autosaveDebounceMs = 800,
		savedIndicatorMs = 2000,
		onMissingOrg,
		onSwitchNavigate,
		onBack,
		onDeleted,
		onLogout,
		class: className
	}: NotePageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let note = $state<ApiNote | null>(null);
	let title = $state('');
	let color = $state<NoteColor>('yellow');
	let pinned = $state(false);
	let saveStatus = $state<NoteSaveStatus>('idle');
	let saveError = $state<string | null>(null);
	let actionBusy = $state(false);
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

	// Content changes in the editor mark the note dirty; loading content uses emitUpdate: false.
	const editor = createEditor({ onUpdate: () => markDirty() });

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		noteId: string;
	}

	const liveEpoch: RequestEpoch = { orgId: null, generation: -1, noteId: '' };

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.noteId = noteId;
	});

	function captureEpoch(): RequestEpoch {
		return { ...liveEpoch };
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.noteId !== liveEpoch.noteId
		);
	}

	// ---- Autosave -------------------------------------------------------------------------

	let dirty = false;
	let saving = false;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let savedTimer: ReturnType<typeof setTimeout> | null = null;

	function clearTimers() {
		if (saveTimer) clearTimeout(saveTimer);
		if (savedTimer) clearTimeout(savedTimer);
		saveTimer = null;
		savedTimer = null;
	}

	function markDirty() {
		if (!note || saveStatus === 'conflict') return;
		dirty = true;
		saveStatus = 'dirty';
		saveError = null;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			void flushSave();
		}, autosaveDebounceMs);
	}

	function snapshot(): ApiNoteUpdateBody {
		const body = (editor?.getJSON() as ApiNoteDocument | undefined) ?? EMPTY_NOTE_DOCUMENT;
		const text = editor?.getText({ blockSeparator: '\n' }) ?? '';
		return {
			title: title.trim().slice(0, 200),
			body,
			body_text: toNoteBodyText(text),
			color,
			pinned
		};
	}

	async function flushSave(): Promise<void> {
		if (!note || !dirty || saving || saveStatus === 'conflict') return;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}

		const epoch = captureEpoch();
		const target = note;
		saving = true;
		dirty = false;
		saveStatus = 'saving';
		try {
			const updated = await api.notes.update(target.id, snapshot(), target.version);
			if (isStale(epoch)) return;
			note = updated;
			if (dirty) {
				// Edits landed while the request was in flight; save again shortly.
				saveStatus = 'dirty';
				saveTimer = setTimeout(() => {
					saveTimer = null;
					void flushSave();
				}, autosaveDebounceMs);
			} else {
				saveStatus = 'saved';
				if (savedTimer) clearTimeout(savedTimer);
				savedTimer = setTimeout(() => {
					savedTimer = null;
					if (saveStatus === 'saved') saveStatus = 'idle';
				}, savedIndicatorMs);
			}
		} catch (error) {
			if (isStale(epoch)) return;
			dirty = true;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				saveStatus = 'conflict';
				saveError = userMessage(
					error,
					'This note was changed elsewhere. Reload to see the latest version — your unsaved edits here will be discarded.'
				);
				return;
			}
			saveStatus = 'error';
			saveError = userMessage(error, 'Could not save note — check your connection and retry.');
		} finally {
			if (!isStale(epoch)) saving = false;
		}
	}

	function retrySave() {
		saveError = null;
		dirty = true;
		void flushSave();
	}

	// ---- Loading ---------------------------------------------------------------------------

	function applyNote(loaded: ApiNote) {
		note = loaded;
		title = loaded.title;
		color = loaded.color;
		pinned = loaded.pinned;
		editor?.commands.setContent(loaded.body as Content, { emitUpdate: false });
	}

	function resetNoteState() {
		clearTimers();
		dirty = false;
		saving = false;
		note = null;
		title = '';
		color = 'yellow';
		pinned = false;
		saveStatus = 'idle';
		saveError = null;
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = { kind: 'forbidden', message: 'Select an organisation before opening notes.' };
			return;
		}
		if (!noteId) {
			viewState = { kind: 'not_found', message: 'Note not found.' };
			return;
		}

		const epoch = captureEpoch();
		resetNoteState();
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}
			const result = await api.notes.get(noteId);
			if (isStale(epoch)) return;
			applyNote(result.data);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.status === 404) {
				viewState = { kind: 'not_found', message: 'Note not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = { kind: 'validation', message: userMessage(error, 'Could not load note.') };
		}
	}

	// ---- Header actions ---------------------------------------------------------------------

	function onTitleChange(value: string) {
		title = value;
		markDirty();
	}

	function onColorChange(next: NoteColor) {
		if (next === color) return;
		color = next;
		markDirty();
	}

	function onTogglePin() {
		pinned = !pinned;
		markDirty();
	}

	async function onDelete() {
		if (!note) return;
		if (!window.confirm('Delete this note? This cannot be undone.')) return;

		const epoch = captureEpoch();
		actionBusy = true;
		try {
			clearTimers();
			dirty = false;
			await api.notes.delete(note.id, note.version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				saveStatus = 'conflict';
				saveError = userMessage(error, 'Note changed elsewhere — reload and try again.');
				return;
			}
			saveError = userMessage(error, 'Could not delete note — try again.');
		} finally {
			if (!isStale(epoch)) actionBusy = false;
		}
	}

	// ---- Org shell ---------------------------------------------------------------------------

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		resetNoteState();
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
			resetNoteState();
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
		void noteId;
		void loadAll();
	});

	// Flush pending edits when the tab is hidden or the component unmounts (route change).
	$effect(() => {
		if (typeof window === 'undefined') return;
		const onVisibility = () => {
			if (document.visibilityState === 'hidden' && dirty) void flushSave();
		};
		const onBeforeUnload = () => {
			if (dirty) void flushSave();
		};
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('beforeunload', onBeforeUnload);
		};
	});

	onDestroy(() => {
		if (dirty && !saving) void flushSave();
		clearTimers();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="note-page">
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
				{#if viewState.kind === 'ready' && note}
					<NoteEditorPage
						{orgName}
						{navGroups}
						{editor}
						{title}
						{color}
						{pinned}
						{saveStatus}
						{saveError}
						{actionBusy}
						showNav={false}
						{onBack}
						{onTitleChange}
						{onColorChange}
						{onTogglePin}
						{onDelete}
						onRetrySave={retrySave}
						onReload={loadAll}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="note-page">
		<p class="text-sm text-destructive" role="alert">
			Select an organisation before opening notes.
		</p>
	</div>
{/if}
