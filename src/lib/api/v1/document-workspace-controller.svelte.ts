import type {
	DocumentBreadcrumb,
	DocumentEntry,
	DocumentMoveTarget,
	DocumentUploadItem,
	DocumentViewMode,
	DocumentWorkspaceView,
	EntityDocumentsProps
} from '$lib/components/crm/entity-documents.svelte';
import { digestBytesToHex, sha256HexSync } from '$lib/crypto/sha256-hex.js';
import type { ApiV1Client } from './client.js';
import { isApiClientError } from './errors.js';
import type {
	ApiDocumentBrowseResult,
	ApiDocumentCategory,
	ApiDocumentEntityType
} from './types.js';

type EntryKind = 'folder' | 'file';

interface CachedEntryMeta {
	kind: EntryKind;
	name: string;
	/** Folder version, or document version for files. */
	version: number;
	/** Link version — required for document move If-Match. */
	linkVersion?: number;
}

/** Inline preview target for image/* and application/pdf. */
export type DocumentPreviewState = {
	documentId: string;
	url: string;
	name: string;
	mimeType: string;
};

/** True when Preview should open an in-app lightbox instead of a new tab. */
export function isInlineDocumentPreview(mimeType: string | null | undefined): boolean {
	if (!mimeType) return false;
	const mime = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
	return mime.startsWith('image/') || mime === 'application/pdf';
}

export interface DocumentWorkspaceControllerOptions {
	client: ApiV1Client;
	entityType: ApiDocumentEntityType;
	entityId: string;
	/** Category applied to new uploads (contract default: other). */
	defaultCategory?: ApiDocumentCategory;
	/** Injected fetch for signed PUT (defaults to global fetch — no auth headers). */
	uploadFetch?: typeof fetch;
	/** Optional clock for upload ids in tests. */
	now?: () => number;
	createId?: () => string;
}

export interface DocumentWorkspaceController {
	readonly view: DocumentWorkspaceView;
	readonly viewMode: DocumentViewMode;
	readonly uploads: DocumentUploadItem[];
	readonly moveTargets: DocumentMoveTarget[];
	readonly folderId: string | null;
	readonly previewState: DocumentPreviewState | null;
	setViewMode(mode: DocumentViewMode): void;
	closePreview(): void;
	refresh(): Promise<void>;
	navigate(folderId: string | null): Promise<void>;
	uploadFiles(files: File[]): void;
	retryUpload(uploadId: string): void;
	cancelUpload(uploadId: string): void;
	createFolder(name: string): Promise<void>;
	rename(id: string, name: string): Promise<void>;
	move(id: string, targetFolderId: string | null): Promise<void>;
	remove(id: string): Promise<void>;
	restore(id: string): Promise<void>;
	download(id: string): Promise<void>;
	preview(id: string): Promise<void>;
	/** Callback bundle for wiring `<EntityDocuments />` without guessing HTTP shapes. */
	entityDocumentsCallbacks(): Pick<
		EntityDocumentsProps,
		| 'onNavigate'
		| 'onViewModeChange'
		| 'onUpload'
		| 'onRetryUpload'
		| 'onCancelUpload'
		| 'onCreateFolder'
		| 'onRename'
		| 'onMove'
		| 'onDelete'
		| 'onRestore'
		| 'onDownload'
		| 'onPreview'
		| 'onRetryView'
	>;
}

export function formatDocumentSizeLabel(sizeBytes: number): string {
	if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '—';
	if (sizeBytes < 1024) return `${sizeBytes} B`;
	const kb = sizeBytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * SHA-256 as lowercase hex. Uses `crypto.subtle` in secure contexts; falls back to
 * pure-JS SHA-256 when subtle is missing (plain HTTP staging / LAN demos).
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (subtle && typeof subtle.digest === 'function') {
		try {
			const digest = await subtle.digest('SHA-256', data);
			return digestBytesToHex(digest);
		} catch {
			// Fall through to pure-JS (some environments expose a broken subtle).
		}
	}
	try {
		return sha256HexSync(data);
	} catch {
		throw new Error(
			'SHA-256 is unavailable in this browser. Open the app over HTTPS (or localhost), or try another browser.'
		);
	}
}

function errorMessage(error: unknown, fallback: string): string {
	if (isApiClientError(error)) return error.message;
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}

function formatUploadedAt(iso: string | null | undefined): string {
	if (!iso) return '—';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

export function mapBrowseToWorkspaceView(
	browse: ApiDocumentBrowseResult,
	breadcrumbs: DocumentBreadcrumb[]
): {
	view: Extract<DocumentWorkspaceView, { kind: 'ready' }>;
	metaById: Map<string, CachedEntryMeta>;
	moveTargets: DocumentMoveTarget[];
} {
	const metaById = new Map<string, CachedEntryMeta>();
	const entries: DocumentEntry[] = [];

	for (const folder of browse.folders ?? []) {
		metaById.set(folder.id, {
			kind: 'folder',
			name: folder.name,
			version: folder.version
		});
		entries.push({
			id: folder.id,
			kind: 'folder',
			name: folder.name,
			updatedAt: formatUploadedAt(folder.updated_at)
		});
	}

	for (const item of browse.documents ?? []) {
		const doc = item.document;
		const link = item.link;
		metaById.set(doc.id, {
			kind: 'file',
			name: doc.name,
			version: doc.version,
			linkVersion: link.version
		});
		entries.push({
			id: doc.id,
			kind: 'file',
			name: doc.name,
			category: doc.category,
			mimeType: doc.mime_type,
			sizeLabel: formatDocumentSizeLabel(doc.size_bytes),
			uploadedAt: formatUploadedAt(doc.uploaded_at ?? doc.created_at),
			deleted: Boolean(doc.deleted_at)
		});
	}

	const moveTargets: DocumentMoveTarget[] = [
		{ id: null, name: 'Entity root' },
		...entries
			.filter((e): e is Extract<DocumentEntry, { kind: 'folder' }> => e.kind === 'folder')
			.map((folder) => ({ id: folder.id, name: folder.name }))
	];

	return {
		view: { kind: 'ready', entries, breadcrumbs },
		metaById,
		moveTargets
	};
}

interface PendingUpload {
	file: File;
	controller: AbortController;
}

export function createDocumentWorkspaceController(
	options: DocumentWorkspaceControllerOptions
): DocumentWorkspaceController {
	const docs = options.client.documents;
	const uploadFetch = options.uploadFetch ?? globalThis.fetch.bind(globalThis);
	const createId =
		options.createId ??
		(() =>
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `upload-${(options.now?.() ?? Date.now()).toString(36)}`);
	const defaultCategory = options.defaultCategory ?? 'other';

	let view = $state<DocumentWorkspaceView>({ kind: 'loading' });
	let viewMode = $state<DocumentViewMode>('list');
	let uploads = $state<DocumentUploadItem[]>([]);
	let moveTargets = $state<DocumentMoveTarget[]>([{ id: null, name: 'Entity root' }]);
	let folderId = $state<string | null>(null);
	let breadcrumbs = $state<DocumentBreadcrumb[]>([{ id: null, name: 'Documents' }]);
	let previewState = $state<DocumentPreviewState | null>(null);
	let metaById = new Map<string, CachedEntryMeta>();
	const pendingByUploadId = new Map<string, PendingUpload>();
	let loadGeneration = 0;

	function patchUpload(id: string, patch: Partial<DocumentUploadItem>): void {
		uploads = uploads.map((item) => (item.id === id ? { ...item, ...patch } : item));
	}

	async function load(targetFolderId: string | null = folderId): Promise<void> {
		const generation = ++loadGeneration;
		view = { kind: 'loading' };
		try {
			const browse = await docs.browse(options.entityType, options.entityId, {
				folder_id: targetFolderId
			});
			if (generation !== loadGeneration) return;
			const mapped = mapBrowseToWorkspaceView(browse, breadcrumbs);
			metaById = mapped.metaById;
			moveTargets = mapped.moveTargets;
			view = mapped.view;
		} catch (error) {
			if (generation !== loadGeneration) return;
			view = {
				kind: 'error',
				message: errorMessage(error, 'Could not load documents')
			};
		}
	}

	async function navigate(nextFolderId: string | null): Promise<void> {
		if (nextFolderId === folderId) {
			await load(nextFolderId);
			return;
		}

		if (nextFolderId === null) {
			breadcrumbs = [{ id: null, name: 'Documents' }];
			folderId = null;
			await load(null);
			return;
		}

		const crumbIndex = breadcrumbs.findIndex((crumb) => crumb.id === nextFolderId);
		if (crumbIndex >= 0) {
			breadcrumbs = breadcrumbs.slice(0, crumbIndex + 1);
			folderId = nextFolderId;
			await load(nextFolderId);
			return;
		}

		const meta = metaById.get(nextFolderId);
		breadcrumbs = [
			...breadcrumbs,
			{ id: nextFolderId, name: meta?.name ?? 'Folder' }
		];
		folderId = nextFolderId;
		await load(nextFolderId);
	}

	async function putSignedUpload(
		signedUrl: string,
		file: File,
		signal: AbortSignal
	): Promise<void> {
		const response = await uploadFetch(signedUrl, {
			method: 'PUT',
			body: file,
			headers: {
				'Content-Type': file.type || 'application/octet-stream'
			},
			signal
		});
		if (!response.ok) {
			throw new Error(`Signed upload failed (${response.status})`);
		}
	}

	async function runUpload(uploadId: string): Promise<void> {
		const pending = pendingByUploadId.get(uploadId);
		if (!pending) return;
		const { file, controller } = pending;

		patchUpload(uploadId, {
			status: 'uploading',
			progress: 5,
			errorMessage: undefined
		});

		try {
			const buffer = await file.arrayBuffer();
			if (controller.signal.aborted) return;
			const digest = await sha256Hex(buffer);
			patchUpload(uploadId, { progress: 20 });

			const intent = await docs.createUploadIntent(
				options.entityType,
				options.entityId,
				{
					name: file.name.slice(0, 160) || 'upload',
					category: defaultCategory,
					mime_type: file.type || 'application/octet-stream',
					size_bytes: file.size,
					sha256: digest,
					folder_id: folderId
				},
				controller.signal
			);
			patchUpload(uploadId, { progress: 40 });

			await putSignedUpload(intent.upload.signed_url, file, controller.signal);
			patchUpload(uploadId, { progress: 80 });

			await docs.finalize(
				intent.document.id,
				{
					expected_size_bytes: file.size,
					expected_sha256: digest
				},
				controller.signal
			);

			pendingByUploadId.delete(uploadId);
			patchUpload(uploadId, { status: 'complete', progress: 100 });
			await load(folderId);
		} catch (error) {
			if (controller.signal.aborted) {
				pendingByUploadId.delete(uploadId);
				patchUpload(uploadId, { status: 'cancelled', progress: 0 });
				return;
			}
			patchUpload(uploadId, {
				status: 'failed',
				errorMessage: errorMessage(error, 'Upload failed')
			});
		}
	}

	function enqueueUploads(files: File[]): void {
		for (const file of files) {
			const id = createId();
			const controller = new AbortController();
			pendingByUploadId.set(id, { file, controller });
			uploads = [
				...uploads,
				{
					id,
					fileName: file.name,
					progress: 0,
					status: 'queued'
				}
			];
			void runUpload(id);
		}
	}

	async function createFolder(name: string): Promise<void> {
		const trimmed = name.trim();
		if (!trimmed) return;
		try {
			await docs.createFolder(options.entityType, options.entityId, {
				name: trimmed.slice(0, 160),
				parent_id: folderId
			});
			await load(folderId);
		} catch (error) {
			view = {
				kind: 'error',
				message: errorMessage(error, 'Could not create folder')
			};
		}
	}

	async function renameEntry(id: string, name: string): Promise<void> {
		const trimmed = name.trim();
		const meta = metaById.get(id);
		if (!meta || !trimmed) return;
		try {
			if (meta.kind === 'folder') {
				await docs.updateFolder(id, { name: trimmed.slice(0, 160) }, meta.version);
			} else {
				await docs.rename(id, { name: trimmed.slice(0, 160) }, meta.version);
			}
			await load(folderId);
		} catch (error) {
			view = {
				kind: 'error',
				message: errorMessage(error, 'Could not rename item')
			};
		}
	}

	async function moveEntry(id: string, targetFolderId: string | null): Promise<void> {
		const meta = metaById.get(id);
		if (!meta) return;
		try {
			if (meta.kind === 'folder') {
				await docs.updateFolder(id, { parent_id: targetFolderId }, meta.version);
			} else {
				const linkVersion = meta.linkVersion;
				if (linkVersion === undefined) {
					throw new Error('Missing link version for document move');
				}
				await docs.move(
					id,
					{
						entity_type: options.entityType,
						entity_id: options.entityId,
						folder_id: targetFolderId
					},
					linkVersion
				);
			}
			await load(folderId);
		} catch (error) {
			view = {
				kind: 'error',
				message: errorMessage(error, 'Could not move item')
			};
		}
	}

	async function removeEntry(id: string): Promise<void> {
		const meta = metaById.get(id);
		if (!meta) return;
		try {
			if (meta.kind === 'folder') {
				await docs.deleteFolder(id, meta.version);
			} else {
				await docs.delete(id, meta.version);
			}
			await load(folderId);
		} catch (error) {
			view = {
				kind: 'error',
				message: errorMessage(error, 'Could not delete item')
			};
		}
	}

	async function restoreEntry(id: string): Promise<void> {
		const meta = metaById.get(id);
		if (!meta) return;
		try {
			if (meta.kind === 'folder') {
				await docs.restoreFolder(id, meta.version);
			} else {
				await docs.restore(id, meta.version);
			}
			await load(folderId);
		} catch (error) {
			view = {
				kind: 'error',
				message: errorMessage(error, 'Could not restore item')
			};
		}
	}

	async function downloadOrPreview(id: string, mode: 'download' | 'preview'): Promise<void> {
		const meta = metaById.get(id);
		if (!meta || meta.kind !== 'file') return;
		try {
			const result = await docs.download(
				id,
				mode === 'preview' ? { inline: true } : undefined
			);
			if (mode === 'download') {
				if (typeof document !== 'undefined') {
					const anchor = document.createElement('a');
					anchor.href = result.signed_url;
					anchor.download = result.name;
					anchor.rel = 'noopener';
					anchor.click();
				}
				return;
			}
			if (isInlineDocumentPreview(result.mime_type)) {
				previewState = {
					documentId: id,
					url: result.signed_url,
					name: result.name,
					mimeType: result.mime_type
				};
				return;
			}
			if (typeof window !== 'undefined') {
				window.open(result.signed_url, '_blank', 'noopener,noreferrer');
			}
		} catch (error) {
			view = {
				kind: 'error',
				message: errorMessage(
					error,
					mode === 'download' ? 'Could not download file' : 'Could not preview file'
				)
			};
		}
	}

	function retryUpload(uploadId: string): void {
		const pending = pendingByUploadId.get(uploadId);
		const item = uploads.find((u) => u.id === uploadId);
		if (!item || item.status !== 'failed') return;
		const file = pending?.file;
		if (!file) return;
		const controller = new AbortController();
		pendingByUploadId.set(uploadId, { file, controller });
		void runUpload(uploadId);
	}

	function cancelUpload(uploadId: string): void {
		const pending = pendingByUploadId.get(uploadId);
		pending?.controller.abort();
		pendingByUploadId.delete(uploadId);
		patchUpload(uploadId, { status: 'cancelled', progress: 0 });
	}

	void load(null);

	return {
		get view() {
			return view;
		},
		get viewMode() {
			return viewMode;
		},
		get uploads() {
			return uploads;
		},
		get moveTargets() {
			return moveTargets;
		},
		get folderId() {
			return folderId;
		},
		get previewState() {
			return previewState;
		},
		setViewMode(mode) {
			viewMode = mode;
		},
		closePreview() {
			previewState = null;
		},
		refresh: () => load(folderId),
		navigate,
		uploadFiles: enqueueUploads,
		retryUpload,
		cancelUpload,
		createFolder,
		rename: renameEntry,
		move: moveEntry,
		remove: removeEntry,
		restore: restoreEntry,
		download: (id) => downloadOrPreview(id, 'download'),
		preview: (id) => downloadOrPreview(id, 'preview'),
		entityDocumentsCallbacks() {
			return {
				onNavigate: (id) => {
					void navigate(id);
				},
				onViewModeChange: (mode) => {
					viewMode = mode;
				},
				onUpload: enqueueUploads,
				onRetryUpload: retryUpload,
				onCancelUpload: cancelUpload,
				onCreateFolder: (name) => {
					void createFolder(name);
				},
				onRename: (id, name) => {
					void renameEntry(id, name);
				},
				onMove: (id, target) => {
					void moveEntry(id, target);
				},
				onDelete: (id) => {
					void removeEntry(id);
				},
				onRestore: (id) => {
					void restoreEntry(id);
				},
				onDownload: (id) => {
					void downloadOrPreview(id, 'download');
				},
				onPreview: (id) => {
					void downloadOrPreview(id, 'preview');
				},
				onRetryView: () => {
					void load(folderId);
				}
			};
		}
	};
}
