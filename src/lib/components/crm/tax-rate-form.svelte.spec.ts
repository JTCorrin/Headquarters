import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TaxRateFormTestHost from './tax-rate-form.test-host.svelte';

describe('TaxRateForm', () => {
	it('rejects editing a default rate to archived', async () => {
		const onValidSubmit = vi.fn();
		render(TaxRateFormTestHost, {
			initial: {
				name: 'VAT 20%',
				ratePercent: '20',
				isDefault: 'true',
				active: 'false'
			},
			onValidSubmit
		});

		await page.getByTestId('tax-rate-submit').click();
		await expect.element(page.getByText(/must remain active/i)).toBeInTheDocument();
		expect(onValidSubmit).not.toHaveBeenCalled();
	});

	it('forces active when marking a rate as default', async () => {
		render(TaxRateFormTestHost, {
			initial: {
				name: 'Zero rated',
				ratePercent: '0',
				isDefault: 'false',
				active: 'false'
			}
		});

		await page.getByTestId('tax-rate-default-trigger').click();
		await page.getByRole('option', { name: 'Yes' }).click();
		await expect.element(page.getByTestId('tax-rate-active-trigger')).toHaveTextContent(/Active/i);
	});
});
