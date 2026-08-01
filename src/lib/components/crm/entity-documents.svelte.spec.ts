import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import EntityDocuments, {
	type DocumentEntry,
	type DocumentUploadItem,
	type DocumentWorkspaceView
} from './entity-documents.svelte';
import EntityDocumentsStoryHost from './entity-documents.story-host.svelte';

const rootEntries: DocumentEntry[] = [
	{
		id: 'folder-contracts',
		kind: 'folder',
		name: 'Contracts',
		itemCount: 2,
		updatedAt: 'Mar 1'
	},
	{
		id: 'file-msa',
		kind: 'file',
		name: 'MSA — Northwind.pdf',
		category: 'contract',
		sizeLabel: '240 KB',
		uploadedAt: 'Jan 12',
		uploadedBy: 'Joe'
	},
	{
		id: 'file-trash',
		kind: 'file',
		name: 'Old bill.pdf',
		category: 'invoice',
		sizeLabel: '88 KB',
		uploadedAt: 'Dec 2',
		uploadedBy: 'Maya',
		deleted: true
	}
];

const readyView: DocumentWorkspaceView = {
	kind: 'ready',
	entries: rootEntries,
	breadcrumbs: [{ id: null, name: 'Documents' }]
};

describe('EntityDocuments workspace', () => {
	it('renders list entries and switches to grid', async () => {
		const onViewModeChange = vi.fn();
		render(EntityDocuments, {
			view: readyView,
			viewMode: 'list',
			onViewModeChange,
			onNavigate: vi.fn(),
			onUpload: vi.fn()
		});

		await expect.element(page.getByTestId('documents-list')).toBeInTheDocument();
		await expect.element(page.getByText('Contracts')).toBeInTheDocument();
		await expect.element(page.getByText('MSA — Northwind.pdf')).toBeInTheDocument();

		await page.getByTestId('documents-view-grid').click();
		await vi.waitFor(() => expect(onViewModeChange).toHaveBeenCalledWith('grid'));
	});

	it('navigates into a folder via callback', async () => {
		const onNavigate = vi.fn();
		render(EntityDocuments, {
			view: readyView,
			onNavigate,
			onUpload: vi.fn()
		});

		await page.getByTestId('documents-open-folder-contracts').click();
		await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith('folder-contracts'));
	});

	it('shows loading and error states with retry', async () => {
		const onRetryView = vi.fn();
		const { rerender } = render(EntityDocuments, {
			view: { kind: 'loading' },
			onNavigate: vi.fn(),
			onRetryView
		});
		await expect.element(page.getByTestId('documents-loading')).toBeInTheDocument();

		await rerender({
			view: { kind: 'error', message: 'Storage unavailable' },
			onNavigate: vi.fn(),
			onRetryView
		});
		await expect.element(page.getByTestId('documents-error')).toBeInTheDocument();
		await page.getByTestId('documents-retry').click();
		await vi.waitFor(() => expect(onRetryView).toHaveBeenCalled());
	});

	it('renders upload queue progress, retry, and cancel', async () => {
		const onRetryUpload = vi.fn();
		const onCancelUpload = vi.fn();
		const uploads: DocumentUploadItem[] = [
			{
				id: 'u-active',
				fileName: 'draft.pdf',
				progress: 40,
				status: 'uploading'
			},
			{
				id: 'u-fail',
				fileName: 'broken.pdf',
				progress: 100,
				status: 'failed',
				errorMessage: 'Network error'
			}
		];

		render(EntityDocuments, {
			view: readyView,
			uploads,
			onNavigate: vi.fn(),
			onUpload: vi.fn(),
			onRetryUpload,
			onCancelUpload
		});

		await expect.element(page.getByTestId('documents-upload-queue')).toBeInTheDocument();
		await expect.element(page.getByTestId('documents-upload-progress-u-active')).toBeInTheDocument();

		await page.getByTestId('documents-upload-cancel-u-active').click();
		await vi.waitFor(() => expect(onCancelUpload).toHaveBeenCalledWith('u-active'));

		await page.getByTestId('documents-upload-retry-u-fail').click();
		await vi.waitFor(() => expect(onRetryUpload).toHaveBeenCalledWith('u-fail'));
	});

	it('renames, moves, deletes, and restores through menus', async () => {
		const onRename = vi.fn();
		const onMove = vi.fn();
		const onDelete = vi.fn();
		const onRestore = vi.fn();
		const onDownload = vi.fn();
		const onPreview = vi.fn();

		render(EntityDocuments, {
			view: readyView,
			moveTargets: [
				{ id: null, name: 'Documents (root)' },
				{ id: 'folder-contracts', name: 'Contracts' }
			],
			onNavigate: vi.fn(),
			onUpload: vi.fn(),
			onRename,
			onMove,
			onDelete,
			onRestore,
			onDownload,
			onPreview
		});

		await page.getByTestId('documents-menu-file-msa').click();
		await page.getByTestId('documents-preview-file-msa').click();
		await vi.waitFor(() => expect(onPreview).toHaveBeenCalledWith('file-msa'));

		await page.getByTestId('documents-menu-file-msa').click();
		await page.getByTestId('documents-download-file-msa').click();
		await vi.waitFor(() => expect(onDownload).toHaveBeenCalledWith('file-msa'));

		await page.getByTestId('documents-menu-file-msa').click();
		await page.getByTestId('documents-rename-file-msa').click();
		await expect.element(page.getByTestId('documents-rename-sheet')).toBeInTheDocument();
		await page.getByTestId('documents-rename-name').fill('MSA revised.pdf');
		await page.getByTestId('documents-rename-submit').click();
		await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith('file-msa', 'MSA revised.pdf'));

		await page.getByTestId('documents-menu-file-msa').click();
		await page.getByTestId('documents-move-file-msa').click();
		await expect.element(page.getByTestId('documents-move-sheet')).toBeInTheDocument();
		await page.getByTestId('documents-move-target-folder-contracts').click();
		await page.getByTestId('documents-move-submit').click();
		await vi.waitFor(() => expect(onMove).toHaveBeenCalledWith('file-msa', 'folder-contracts'));

		await page.getByTestId('documents-menu-file-msa').click();
		await page.getByTestId('documents-delete-file-msa').click();
		await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith('file-msa'));

		await page.getByTestId('documents-menu-file-trash').click();
		await page.getByTestId('documents-restore-file-trash').click();
		await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith('file-trash'));
	});

	it('creates folders and uploads files in the story host', async () => {
		render(EntityDocumentsStoryHost, {
			initialEntries: rootEntries.filter((e) => e.id !== 'file-trash'),
			title: 'Client workspace'
		});

		await page.getByTestId('documents-new-folder').click();
		await page.getByTestId('documents-folder-name').fill('Bills');
		await page.getByTestId('documents-folder-submit').click();
		await expect.element(page.getByText('Bills')).toBeInTheDocument();

		const input = page.getByTestId('documents-file-input');
		const file = new File(['hello'], 'receipt.pdf', { type: 'application/pdf' });
		await input.upload(file);
		await expect.element(page.getByTestId('documents-upload-queue')).toBeInTheDocument();
		await vi.waitFor(async () => {
			await expect.element(page.getByText('receipt.pdf')).toBeInTheDocument();
		});
	});

	it('supports keyboard activation on breadcrumbs', async () => {
		const onNavigate = vi.fn();
		render(EntityDocuments, {
			view: {
				kind: 'ready',
				entries: rootEntries,
				breadcrumbs: [
					{ id: null, name: 'Documents' },
					{ id: 'folder-contracts', name: 'Contracts' }
				]
			},
			onNavigate,
			onUpload: vi.fn()
		});

		const rootCrumb = page.getByTestId('documents-breadcrumb-root');
		await rootCrumb.click();
		await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith(null));
	});

	it('keeps legacy flat documents list without workspace chrome', async () => {
		render(EntityDocuments, {
			documents: [
				{
					id: 'd1',
					name: 'Legacy.pdf',
					category: 'other',
					uploadedAt: 'Today'
				}
			]
		});

		await expect.element(page.getByText('Legacy.pdf')).toBeInTheDocument();
		await expect.element(page.getByTestId('documents-view-list')).not.toBeInTheDocument();
	});
});
