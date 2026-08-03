import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DocumentFilePreview from './document-file-preview.svelte';

describe('DocumentFilePreview', () => {
	it('renders an image lightbox from the signed URL', async () => {
		const onClose = vi.fn();
		const onDownload = vi.fn();
		render(DocumentFilePreview, {
			preview: {
				documentId: 'doc-1',
				url: 'https://storage.example.test/photo.png',
				name: 'photo.png',
				mimeType: 'image/png'
			},
			onClose,
			onDownload
		});

		await expect.element(page.getByTestId('documents-preview-sheet')).toBeInTheDocument();
		await expect.element(page.getByTestId('documents-preview-image')).toBeInTheDocument();
		await expect
			.element(page.getByTestId('documents-preview-image'))
			.toHaveAttribute('src', 'https://storage.example.test/photo.png');

		await page.getByTestId('documents-preview-download').click();
		await vi.waitFor(() => expect(onDownload).toHaveBeenCalled());
	});

	it('renders a PDF iframe preview', async () => {
		render(DocumentFilePreview, {
			preview: {
				documentId: 'doc-2',
				url: 'https://storage.example.test/msa.pdf',
				name: 'msa.pdf',
				mimeType: 'application/pdf'
			}
		});

		await expect.element(page.getByTestId('documents-preview-pdf')).toBeInTheDocument();
		await expect
			.element(page.getByTestId('documents-preview-pdf'))
			.toHaveAttribute('src', 'https://storage.example.test/msa.pdf');
	});
});
