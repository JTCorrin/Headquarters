import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import BillFormTestHost from './bill-form.test-host.svelte';

describe('BillForm vendor picker', () => {
	it('keeps Create new vendor when options are empty (zero-vendor bootstrap)', async () => {
		const onCreateVendor = vi.fn();
		render(BillFormTestHost, {
			vendorOptions: [],
			onCreateVendor
		});

		await expect.element(page.getByTestId('vendor-picker-input')).toBeInTheDocument();
		await expect.element(page.getByPlaceholder('Cloudflare')).not.toBeInTheDocument();

		await page.getByTestId('vendor-picker-input').click();
		await expect.element(page.getByText('Create new vendor')).toBeInTheDocument();
		await page.getByText('Create new vendor').click();
		expect(onCreateVendor).toHaveBeenCalledTimes(1);
	});

	it('allows free-text vendor only when create-vendor is unavailable', async () => {
		render(BillFormTestHost, {
			vendorOptions: [],
			enableCreateVendor: false
		});

		await expect.element(page.getByPlaceholder('Cloudflare')).toBeInTheDocument();
		await expect.element(page.getByTestId('vendor-picker-input')).not.toBeInTheDocument();
	});
});
