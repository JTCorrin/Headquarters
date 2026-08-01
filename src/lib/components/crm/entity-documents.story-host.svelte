<script lang="ts">
	import EntityDocuments, {
		type DocumentBreadcrumb,
		type DocumentEntry,
		type DocumentFileEntry,
		type DocumentMoveTarget,
		type DocumentUploadItem,
		type DocumentViewMode,
		type DocumentWorkspaceView
	} from './entity-documents.svelte';

	export interface EntityDocumentsStoryHostProps {
		initialEntries?: DocumentEntry[];
		title?: string;
		emptyMessage?: string;
		failUploads?: boolean;
		initialView?: DocumentWorkspaceView['kind'];
		errorMessage?: string;
		class?: string;
	}

	let {
		initialEntries = [],
		title = 'Documents',
		emptyMessage = 'No documents in this folder yet.',
		failUploads = false,
		initialView = 'ready',
		errorMessage = 'Could not load documents.',
		class: className
	}: EntityDocumentsStoryHostProps = $props();

	type StoredFile = DocumentFileEntry & { folderId: string | null };
	type StoredFolder = {
		id: string;
		name: string;
		parentId: string | null;
		updatedAt?: string;
	};

	const seedFolders = $derived(
		initialEntries
			.filter((e): e is Extract<DocumentEntry, { kind: 'folder' }> => e.kind === 'folder')
			.map((f) => ({
				id: f.id,
				name: f.name,
				parentId: null as string | null,
				updatedAt: f.updatedAt
			}))
	);
	const seedFiles = $derived(
		initialEntries
			.filter((e): e is DocumentFileEntry => e.kind === 'file')
			.map((f) => ({ ...f, folderId: null as string | null }))
	);

	let folders = $state<StoredFolder[]>([]);
	let files = $state<StoredFile[]>([]);
	let currentFolderId = $state<string | null>(null);
	let viewMode = $state<DocumentViewMode>('list');
	let uploads = $state<DocumentUploadItem[]>([]);
	let viewKind = $state<DocumentWorkspaceView['kind']>('ready');
	let seeded = $state(false);
	/** When set, next simulateUpload uses this instead of the failUploads prop. */
	let forceUploadOutcome = $state<'fail' | 'succeed' | null>(null);

	$effect(() => {
		if (seeded) return;
		folders = seedFolders.map((f) => ({ ...f }));
		files = seedFiles.map((f) => ({ ...f }));
		viewKind = initialView;
		seeded = true;
	});

	const breadcrumbs = $derived.by((): DocumentBreadcrumb[] => {
		const trail: DocumentBreadcrumb[] = [{ id: null, name: 'Documents' }];
		let cursor = currentFolderId;
		const stack: DocumentBreadcrumb[] = [];
		while (cursor) {
			const folder = folders.find((f) => f.id === cursor);
			if (!folder) break;
			stack.unshift({ id: folder.id, name: folder.name });
			cursor = folder.parentId;
		}
		return [...trail, ...stack];
	});

	const entries = $derived.by((): DocumentEntry[] => {
		const folderEntries: DocumentEntry[] = folders
			.filter((f) => f.parentId === currentFolderId)
			.map((f) => ({
				id: f.id,
				kind: 'folder' as const,
				name: f.name,
				itemCount:
					files.filter((file) => file.folderId === f.id && !file.deleted).length +
					folders.filter((child) => child.parentId === f.id).length,
				updatedAt: f.updatedAt
			}));
		const fileEntries: DocumentEntry[] = files
			.filter((f) => f.folderId === currentFolderId)
			.map(({ folderId: _folderId, ...file }) => file);
		return [...folderEntries, ...fileEntries];
	});

	const view = $derived.by((): DocumentWorkspaceView => {
		if (viewKind === 'loading') return { kind: 'loading' };
		if (viewKind === 'error') return { kind: 'error', message: errorMessage };
		return { kind: 'ready', entries, breadcrumbs };
	});

	const moveTargets = $derived.by((): DocumentMoveTarget[] => {
		const targets: DocumentMoveTarget[] = [{ id: null, name: 'Documents (root)' }];
		for (const folder of folders) {
			if (folder.id === currentFolderId) continue;
			targets.push({ id: folder.id, name: folder.name });
		}
		return targets;
	});

	function onNavigate(folderId: string | null) {
		currentFolderId = folderId;
	}

	function onCreateFolder(name: string) {
		folders = [
			...folders,
			{
				id: crypto.randomUUID(),
				name,
				parentId: currentFolderId,
				updatedAt: 'Just now'
			}
		];
	}

	function onRename(id: string, name: string) {
		folders = folders.map((f) => (f.id === id ? { ...f, name, updatedAt: 'Just now' } : f));
		files = files.map((f) => (f.id === id ? { ...f, name } : f));
	}

	function onMove(id: string, targetFolderId: string | null) {
		folders = folders.map((f) =>
			f.id === id ? { ...f, parentId: targetFolderId, updatedAt: 'Just now' } : f
		);
		files = files.map((f) => (f.id === id ? { ...f, folderId: targetFolderId } : f));
	}

	function onDelete(id: string) {
		const folder = folders.find((f) => f.id === id);
		if (folder) {
			folders = folders.filter((f) => f.id !== id);
			return;
		}
		files = files.map((f) => (f.id === id ? { ...f, deleted: true } : f));
	}

	function onRestore(id: string) {
		files = files.map((f) => (f.id === id ? { ...f, deleted: false } : f));
	}

	function onDownload(_id: string) {
		/* Storybook / tests observe via callback spies when wrapped. */
	}

	function onPreview(_id: string) {
		/* no-op host default */
	}

	function onUpload(selected: File[]) {
		for (const file of selected) {
			const id = crypto.randomUUID();
			uploads = [
				...uploads,
				{
					id,
					fileName: file.name,
					progress: 0,
					status: 'uploading'
				}
			];
			simulateUpload(id, file);
		}
	}

	function simulateUpload(id: string, file: File) {
		let progress = 0;
		const tick = () => {
			const current = uploads.find((u) => u.id === id);
			if (!current || current.status === 'cancelled') return;
			progress += 34;
			if (progress < 100) {
				uploads = uploads.map((u) =>
					u.id === id ? { ...u, progress: Math.min(progress, 99), status: 'uploading' } : u
				);
				setTimeout(tick, 80);
				return;
			}
			const shouldFail =
				forceUploadOutcome === 'fail' || (forceUploadOutcome === null && failUploads);
			forceUploadOutcome = null;
			if (shouldFail) {
				uploads = uploads.map((u) =>
					u.id === id
						? {
								...u,
								progress: 100,
								status: 'failed',
								errorMessage: 'Network error while uploading'
							}
						: u
				);
				return;
			}
			uploads = uploads.map((u) =>
				u.id === id ? { ...u, progress: 100, status: 'complete' } : u
			);
			files = [
				{
					id: crypto.randomUUID(),
					kind: 'file',
					name: file.name,
					category: 'other',
					sizeLabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
					uploadedAt: 'Just now',
					uploadedBy: 'You',
					folderId: currentFolderId
				},
				...files
			];
		};
		setTimeout(tick, 60);
	}

	function onRetryUpload(uploadId: string) {
		const item = uploads.find((u) => u.id === uploadId);
		if (!item) return;
		uploads = uploads.map((u) =>
			u.id === uploadId
				? { ...u, status: 'uploading', progress: 0, errorMessage: undefined }
				: u
		);
		forceUploadOutcome = 'succeed';
		simulateUpload(uploadId, new File([item.fileName], item.fileName));
	}

	function onCancelUpload(uploadId: string) {
		uploads = uploads.map((u) =>
			u.id === uploadId ? { ...u, status: 'cancelled', progress: u.progress } : u
		);
	}

	function onRetryView() {
		viewKind = 'ready';
	}
</script>

<EntityDocuments
	{title}
	{emptyMessage}
	{view}
	{viewMode}
	{uploads}
	{moveTargets}
	class={className}
	onNavigate={onNavigate}
	onViewModeChange={(mode) => {
		viewMode = mode;
	}}
	onUpload={onUpload}
	onRetryUpload={onRetryUpload}
	onCancelUpload={onCancelUpload}
	onCreateFolder={onCreateFolder}
	onRename={onRename}
	onMove={onMove}
	onDelete={onDelete}
	onRestore={onRestore}
	onDownload={onDownload}
	onPreview={onPreview}
	onRetryView={onRetryView}
/>
