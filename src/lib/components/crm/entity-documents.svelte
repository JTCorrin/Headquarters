<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { DocumentFormData } from '$lib/schemas/document.js';
	import DocumentFormDrawer from './document-form-drawer.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { cn } from '$lib/utils.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import ListIcon from '@lucide/svelte/icons/list';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import FolderInputIcon from '@lucide/svelte/icons/folder-input';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';

	/** Legacy flat document row (profile stories / attach drawer). */
	export interface EntityDocument {
		id: string;
		name: string;
		category: string;
		sizeLabel?: string;
		uploadedAt: string;
		uploadedBy?: string;
	}

	export interface DocumentBreadcrumb {
		/** `null` = entity root */
		id: string | null;
		name: string;
	}

	export interface DocumentFolderEntry {
		id: string;
		kind: 'folder';
		name: string;
		itemCount?: number;
		updatedAt?: string;
	}

	export interface DocumentFileEntry {
		id: string;
		kind: 'file';
		name: string;
		category?: string;
		mimeType?: string;
		sizeLabel?: string;
		uploadedAt: string;
		uploadedBy?: string;
		/** Soft-deleted; show restore instead of delete. */
		deleted?: boolean;
	}

	export type DocumentEntry = DocumentFolderEntry | DocumentFileEntry;

	export type DocumentWorkspaceView =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| {
				kind: 'ready';
				entries: DocumentEntry[];
				breadcrumbs: DocumentBreadcrumb[];
		  };

	export type DocumentViewMode = 'list' | 'grid';

	export type DocumentUploadStatus =
		| 'queued'
		| 'uploading'
		| 'failed'
		| 'complete'
		| 'cancelled';

	export interface DocumentUploadItem {
		id: string;
		fileName: string;
		/** 0–100 */
		progress: number;
		status: DocumentUploadStatus;
		errorMessage?: string;
	}

	export interface DocumentMoveTarget {
		id: string | null;
		name: string;
	}

	export interface EntityDocumentsProps {
		/** Legacy flat list — mapped to root files when workspace view is omitted. */
		documents?: EntityDocument[];
		/** Legacy Superforms attach drawer. */
		form?: SuperForm<DocumentFormData>;
		drawerOpen?: boolean;
		emptyMessage?: string;
		class?: string;
		title?: string;
		/** Injected workspace view model (preferred). */
		view?: DocumentWorkspaceView;
		viewMode?: DocumentViewMode;
		uploads?: DocumentUploadItem[];
		/** Folders available as move destinations (injection). */
		moveTargets?: DocumentMoveTarget[];
		onNavigate?: (folderId: string | null) => void;
		onViewModeChange?: (mode: DocumentViewMode) => void;
		onUpload?: (files: File[]) => void;
		onRetryUpload?: (uploadId: string) => void;
		onCancelUpload?: (uploadId: string) => void;
		onCreateFolder?: (name: string) => void;
		onRename?: (id: string, name: string) => void;
		onMove?: (id: string, targetFolderId: string | null) => void;
		onDelete?: (id: string) => void;
		onRestore?: (id: string) => void;
		onDownload?: (id: string) => void;
		onPreview?: (id: string) => void;
		onRetryView?: () => void;
	}

	let {
		documents = [],
		form,
		drawerOpen = $bindable(false),
		emptyMessage = 'No documents attached yet.',
		class: className,
		title = 'Documents',
		view,
		viewMode = 'list',
		uploads = [],
		moveTargets = [],
		onNavigate,
		onViewModeChange,
		onUpload,
		onRetryUpload,
		onCancelUpload,
		onCreateFolder,
		onRename,
		onMove,
		onDelete,
		onRestore,
		onDownload,
		onPreview,
		onRetryView
	}: EntityDocumentsProps = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	let createFolderOpen = $state(false);
	let createFolderName = $state('');
	let renameOpen = $state(false);
	let renameId = $state<string | null>(null);
	let renameName = $state('');
	let moveOpen = $state(false);
	let moveId = $state<string | null>(null);
	let moveTargetId = $state<string | null>(null);

	const resolvedView = $derived.by((): DocumentWorkspaceView => {
		if (view) return view;
		const entries: DocumentEntry[] = documents.map((doc) => ({
			id: doc.id,
			kind: 'file' as const,
			name: doc.name,
			category: doc.category,
			sizeLabel: doc.sizeLabel,
			uploadedAt: doc.uploadedAt,
			uploadedBy: doc.uploadedBy
		}));
		return {
			kind: 'ready',
			entries,
			breadcrumbs: [{ id: null, name: 'Documents' }]
		};
	});

	const breadcrumbs = $derived(
		resolvedView.kind === 'ready' ? resolvedView.breadcrumbs : [{ id: null, name: 'Documents' }]
	);
	const entries = $derived(resolvedView.kind === 'ready' ? resolvedView.entries : []);
	const isEmpty = $derived(resolvedView.kind === 'ready' && entries.length === 0);
	const workspaceEnabled = $derived(
		Boolean(view || onNavigate || onUpload || onCreateFolder || onRename || onMove)
	);

	function openUploadPicker() {
		fileInput?.click();
	}

	function onFilesSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		if (files.length) onUpload?.(files);
	}

	function openCreateFolder() {
		createFolderName = '';
		createFolderOpen = true;
	}

	function submitCreateFolder() {
		const name = createFolderName.trim();
		if (!name) return;
		onCreateFolder?.(name);
		createFolderOpen = false;
		createFolderName = '';
	}

	function openRename(entry: DocumentEntry) {
		renameId = entry.id;
		renameName = entry.name;
		renameOpen = true;
	}

	function submitRename() {
		const name = renameName.trim();
		if (!renameId || !name) return;
		onRename?.(renameId, name);
		renameOpen = false;
		renameId = null;
	}

	function openMove(entry: DocumentEntry) {
		moveId = entry.id;
		moveTargetId = moveTargets[0]?.id ?? null;
		moveOpen = true;
	}

	function submitMove() {
		if (!moveId) return;
		onMove?.(moveId, moveTargetId);
		moveOpen = false;
		moveId = null;
	}

	function entryMeta(entry: DocumentEntry): string {
		if (entry.kind === 'folder') {
			const count = entry.itemCount ?? 0;
			const bits = [`${count} item${count === 1 ? '' : 's'}`];
			if (entry.updatedAt) bits.push(entry.updatedAt);
			return bits.join(' · ');
		}
		const bits = [entry.uploadedAt];
		if (entry.uploadedBy) bits.push(entry.uploadedBy);
		if (entry.sizeLabel) bits.push(entry.sizeLabel);
		return bits.join(' · ');
	}
</script>

<section
	class={cn(
		'bg-card flex min-h-0 flex-col overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
	data-testid="entity-documents"
	aria-label={title}
>
	<div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
		<div class="min-w-0">
			<p class="text-sm font-semibold tracking-tight">{title}</p>
			{#if resolvedView.kind === 'ready'}
				<p class="text-muted-foreground text-xs">
					{entries.length} item{entries.length === 1 ? '' : 's'}
				</p>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if workspaceEnabled}
				<div
					class="bg-muted/60 flex rounded-xl p-0.5 ring-1 ring-foreground/5"
					role="group"
					aria-label="View mode"
				>
					<Button
						type="button"
						size="sm"
						variant={viewMode === 'list' ? 'secondary' : 'ghost'}
						class="h-8 px-2"
						aria-pressed={viewMode === 'list'}
						data-testid="documents-view-list"
						onclick={() => onViewModeChange?.('list')}
					>
						<ListIcon class="size-3.5" />
						<span class="sr-only">List</span>
					</Button>
					<Button
						type="button"
						size="sm"
						variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
						class="h-8 px-2"
						aria-pressed={viewMode === 'grid'}
						data-testid="documents-view-grid"
						onclick={() => onViewModeChange?.('grid')}
					>
						<LayoutGridIcon class="size-3.5" />
						<span class="sr-only">Grid</span>
					</Button>
				</div>
				{#if onCreateFolder}
					<Button
						type="button"
						size="sm"
						variant="outline"
						data-testid="documents-new-folder"
						onclick={openCreateFolder}
					>
						<FolderPlusIcon class="size-3.5" />
						New folder
					</Button>
				{/if}
				{#if onUpload}
					<Button type="button" size="sm" data-testid="documents-upload" onclick={openUploadPicker}>
						<UploadIcon class="size-3.5" />
						Upload
					</Button>
					<input
						bind:this={fileInput}
						type="file"
						class="sr-only"
						multiple
						data-testid="documents-file-input"
						onchange={onFilesSelected}
					/>
				{/if}
			{/if}
			{#if form}
				<DocumentFormDrawer bind:open={drawerOpen} {form}>
					{#snippet trigger()}
						<Button type="button" size="sm" variant={workspaceEnabled ? 'outline' : 'default'}>
							<PlusIcon class="size-3.5" />
							Attach
						</Button>
					{/snippet}
				</DocumentFormDrawer>
			{/if}
		</div>
	</div>

	{#if workspaceEnabled && breadcrumbs.length > 0}
		<nav
			class="border-t px-4 py-2"
			aria-label="Folder breadcrumbs"
			data-testid="documents-breadcrumbs"
		>
			<ol class="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-xs">
				{#each breadcrumbs as crumb, index (crumb.id ?? 'root')}
					<li class="flex items-center gap-1">
						{#if index > 0}
							<ChevronRightIcon class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
						{/if}
						{#if index === breadcrumbs.length - 1}
							<span class="font-medium" aria-current="page" data-testid="documents-breadcrumb-current"
								>{crumb.name}</span
							>
						{:else}
							<button
								type="button"
								class="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
								data-testid={`documents-breadcrumb-${crumb.id ?? 'root'}`}
								onclick={() => onNavigate?.(crumb.id)}
							>
								{crumb.name}
							</button>
						{/if}
					</li>
				{/each}
			</ol>
		</nav>
	{/if}

	{#if uploads.length > 0}
		<div class="border-t px-4 py-3" data-testid="documents-upload-queue" aria-live="polite">
			<p class="mb-2 text-xs font-medium tracking-tight">Uploads</p>
			<ul class="m-0 list-none space-y-2 p-0">
				{#each uploads as upload (upload.id)}
					<li
						class="bg-muted/40 flex items-center gap-3 rounded-2xl px-3 py-2 ring-1 ring-foreground/5"
						data-testid={`documents-upload-${upload.id}`}
					>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{upload.fileName}</p>
							{#if upload.status === 'failed'}
								<p class="text-destructive mt-0.5 text-xs">
									{upload.errorMessage ?? 'Upload failed'}
								</p>
							{:else if upload.status === 'cancelled'}
								<p class="text-muted-foreground mt-0.5 text-xs">Cancelled</p>
							{:else if upload.status === 'complete'}
								<p class="text-muted-foreground mt-0.5 text-xs">Complete</p>
							{:else}
								<div class="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
									<div
										class="bg-primary h-full transition-[width]"
										style={`width: ${Math.max(0, Math.min(100, upload.progress))}%`}
										data-testid={`documents-upload-progress-${upload.id}`}
									></div>
								</div>
							{/if}
						</div>
						{#if upload.status === 'failed' && onRetryUpload}
							<Button
								type="button"
								size="sm"
								variant="outline"
								data-testid={`documents-upload-retry-${upload.id}`}
								onclick={() => onRetryUpload(upload.id)}
							>
								Retry
							</Button>
						{/if}
						{#if (upload.status === 'queued' || upload.status === 'uploading') && onCancelUpload}
							<Button
								type="button"
								size="sm"
								variant="ghost"
								data-testid={`documents-upload-cancel-${upload.id}`}
								onclick={() => onCancelUpload(upload.id)}
							>
								<XIcon class="size-3.5" />
								<span class="sr-only">Cancel upload</span>
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if resolvedView.kind === 'loading'}
		<div
			class="text-muted-foreground border-t px-4 py-10 text-center text-sm"
			role="status"
			data-testid="documents-loading"
		>
			Loading documents…
		</div>
	{:else if resolvedView.kind === 'error'}
		<div
			class="border-t px-4 py-8 text-center"
			role="alert"
			data-testid="documents-error"
		>
			<div class="text-destructive mx-auto mb-2 flex size-10 items-center justify-center rounded-2xl bg-destructive/10">
				<AlertCircleIcon class="size-5" />
			</div>
			<p class="text-sm font-medium">{resolvedView.message}</p>
			{#if onRetryView}
				<div class="mt-3">
					<Button type="button" size="sm" variant="outline" data-testid="documents-retry" onclick={onRetryView}>
						Retry
					</Button>
				</div>
			{/if}
		</div>
	{:else if isEmpty}
		<p
			class="text-muted-foreground border-t px-4 py-8 text-center text-sm"
			data-testid="documents-empty"
		>
			{emptyMessage}
		</p>
	{:else if viewMode === 'grid'}
		<ul
			class="m-0 grid list-none grid-cols-2 gap-3 border-t p-4 sm:grid-cols-3 lg:grid-cols-4"
			data-testid="documents-grid"
		>
			{#each entries as entry (entry.id)}
				<li>
					<div
						class={cn(
							'hover:bg-muted/40 group flex h-full flex-col rounded-2xl p-3 ring-1 ring-foreground/5',
							entry.kind === 'folder' && 'cursor-pointer'
						)}
						data-testid={`documents-entry-${entry.id}`}
					>
					<button
						type="button"
						class="flex min-h-0 flex-1 flex-col items-start gap-2 text-left"
						data-testid={`documents-open-${entry.id}`}
						onclick={() => {
							if (entry.kind === 'folder') onNavigate?.(entry.id);
							else onPreview?.(entry.id);
						}}
					>
							<div
								class="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl"
							>
								{#if entry.kind === 'folder'}
									<FolderIcon class="size-5" />
								{:else}
									<FileTextIcon class="size-5" />
								{/if}
							</div>
							<p class="line-clamp-2 w-full text-sm font-medium">{entry.name}</p>
							<p class="text-muted-foreground text-xs">{entryMeta(entry)}</p>
						</button>
						{#if entry.kind === 'file' && entry.category}
							<div class="mt-2">
								<StatusBadge status={entry.category} />
							</div>
						{/if}
						<div class="mt-2 flex justify-end opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
							{@render entryMenu(entry)}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="m-0 list-none border-t p-0" data-testid="documents-list">
			{#each entries as entry (entry.id)}
				<li
					class="hover:bg-muted/40 flex items-start gap-3 border-t px-4 py-3 first:border-t-0"
					data-testid={`documents-entry-${entry.id}`}
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-start gap-3 text-left"
						data-testid={`documents-open-${entry.id}`}
						onclick={() => {
							if (entry.kind === 'folder') onNavigate?.(entry.id);
							else onPreview?.(entry.id);
						}}
					>
						<div
							class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl"
						>
							{#if entry.kind === 'folder'}
								<FolderIcon class="size-4" />
							{:else}
								<FileTextIcon class="size-4" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{entry.name}</p>
							<p class="text-muted-foreground mt-0.5 text-xs">{entryMeta(entry)}</p>
						</div>
					</button>
					{#if entry.kind === 'file' && entry.category}
						<StatusBadge status={entry.category} />
					{/if}
					{@render entryMenu(entry)}
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#snippet entryMenu(entry: DocumentEntry)}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					size="sm"
					variant="ghost"
					class="h-8 w-8 shrink-0 p-0"
					data-testid={`documents-menu-${entry.id}`}
					aria-label={`Actions for ${entry.name}`}
				>
					<MoreHorizontalIcon class="size-4" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-44">
			{#if entry.kind === 'file' && onPreview}
				<DropdownMenu.Item
					data-testid={`documents-preview-${entry.id}`}
					onclick={() => onPreview(entry.id)}
				>
					<EyeIcon class="size-3.5" />
					Preview
				</DropdownMenu.Item>
			{/if}
			{#if entry.kind === 'file' && onDownload}
				<DropdownMenu.Item
					data-testid={`documents-download-${entry.id}`}
					onclick={() => onDownload(entry.id)}
				>
					<DownloadIcon class="size-3.5" />
					Download
				</DropdownMenu.Item>
			{/if}
			{#if onRename}
				<DropdownMenu.Item
					data-testid={`documents-rename-${entry.id}`}
					onclick={() => openRename(entry)}
				>
					<PencilIcon class="size-3.5" />
					Rename
				</DropdownMenu.Item>
			{/if}
			{#if onMove}
				<DropdownMenu.Item
					data-testid={`documents-move-${entry.id}`}
					onclick={() => openMove(entry)}
				>
					<FolderInputIcon class="size-3.5" />
					Move
				</DropdownMenu.Item>
			{/if}
			{#if entry.kind === 'file' && entry.deleted && onRestore}
				<DropdownMenu.Item
					data-testid={`documents-restore-${entry.id}`}
					onclick={() => onRestore(entry.id)}
				>
					<RotateCcwIcon class="size-3.5" />
					Restore
				</DropdownMenu.Item>
			{:else if onDelete}
				<DropdownMenu.Item
					variant="destructive"
					data-testid={`documents-delete-${entry.id}`}
					onclick={() => onDelete(entry.id)}
				>
					<Trash2Icon class="size-3.5" />
					Delete
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<Sheet.Root bind:open={createFolderOpen}>
	<Sheet.Content side="bottom" class="mx-auto w-full max-w-md" data-testid="documents-create-folder-sheet">
		<Sheet.Header>
			<Sheet.Title>New folder</Sheet.Title>
			<Sheet.Description>Create a folder in the current location.</Sheet.Description>
		</Sheet.Header>
		<div class="space-y-3 px-4 pb-4">
			<div class="space-y-2">
				<Label for="documents-folder-name">Name</Label>
				<Input
					id="documents-folder-name"
					data-testid="documents-folder-name"
					bind:value={createFolderName}
					placeholder="Contracts"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							submitCreateFolder();
						}
					}}
				/>
			</div>
			<Button type="button" class="w-full" data-testid="documents-folder-submit" onclick={submitCreateFolder}>
				Create folder
			</Button>
		</div>
	</Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={renameOpen}>
	<Sheet.Content side="bottom" class="mx-auto w-full max-w-md" data-testid="documents-rename-sheet">
		<Sheet.Header>
			<Sheet.Title>Rename</Sheet.Title>
			<Sheet.Description>Update the display name for this item.</Sheet.Description>
		</Sheet.Header>
		<div class="space-y-3 px-4 pb-4">
			<div class="space-y-2">
				<Label for="documents-rename-name">Name</Label>
				<Input
					id="documents-rename-name"
					data-testid="documents-rename-name"
					bind:value={renameName}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							submitRename();
						}
					}}
				/>
			</div>
			<Button type="button" class="w-full" data-testid="documents-rename-submit" onclick={submitRename}>
				Save name
			</Button>
		</div>
	</Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={moveOpen}>
	<Sheet.Content side="bottom" class="mx-auto w-full max-w-md" data-testid="documents-move-sheet">
		<Sheet.Header>
			<Sheet.Title>Move</Sheet.Title>
			<Sheet.Description>Choose a destination folder.</Sheet.Description>
		</Sheet.Header>
		<div class="space-y-3 px-4 pb-4">
			{#if moveTargets.length === 0}
				<p class="text-muted-foreground text-sm">No move destinations available.</p>
			{:else}
				<ul class="m-0 list-none space-y-1 p-0" role="listbox" aria-label="Move destinations">
					{#each moveTargets as target (target.id ?? 'root')}
						<li>
							<button
								type="button"
								class={cn(
									'hover:bg-muted/60 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ring-1 ring-transparent',
									moveTargetId === target.id && 'bg-muted ring-foreground/10'
								)}
								role="option"
								aria-selected={moveTargetId === target.id}
								data-testid={`documents-move-target-${target.id ?? 'root'}`}
								onclick={() => {
									moveTargetId = target.id;
								}}
							>
								<FolderIcon class="text-muted-foreground size-4" />
								{target.name}
							</button>
						</li>
					{/each}
				</ul>
				<Button type="button" class="w-full" data-testid="documents-move-submit" onclick={submitMove}>
					Move here
				</Button>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
