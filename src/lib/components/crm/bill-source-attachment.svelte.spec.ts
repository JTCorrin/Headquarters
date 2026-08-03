import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import BillSourceAttachment from './bill-source-attachment.svelte';

describe('BillSourceAttachment', () => {
	it('shows upload CTA when empty and editable', async () => {
		render(BillSourceAttachment, {
			attachment: null,
			canEdit: true
		});
		await expect.element(page.getByTestId('bill-source-upload')).toBeInTheDocument();
		await expect.element(page.getByTestId('bill-source-empty')).toBeInTheDocument();
	});

	it('shows preview and clear when attachment is present', async () => {
		const onClear = vi.fn();
		const onPreview = vi.fn();
		render(BillSourceAttachment, {
			attachment: {
				id: 'doc-1',
				name: 'vendor-invoice.pdf',
				mimeType: 'application/pdf',
				version: 1,
				sizeBytes: 2048
			},
			canEdit: true,
			onClear,
			onPreview
		});
		await expect.element(page.getByTestId('bill-source-name')).toHaveTextContent('vendor-invoice.pdf');
		await page.getByTestId('bill-source-preview').click();
		expect(onPreview).toHaveBeenCalled();
		await page.getByTestId('bill-source-clear').click();
		expect(onClear).toHaveBeenCalled();
	});

	it('hides edit actions when not editable', async () => {
		render(BillSourceAttachment, {
			attachment: {
				id: 'doc-1',
				name: 'locked.pdf',
				mimeType: 'application/pdf',
				version: 1,
				sizeBytes: 100
			},
			canEdit: false
		});
		await expect.element(page.getByTestId('bill-source-preview')).toBeInTheDocument();
		await expect.element(page.getByTestId('bill-source-clear')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('bill-source-upload')).not.toBeInTheDocument();
	});
});
