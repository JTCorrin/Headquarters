import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ContactFormTestHost from './contact-form.test-host.svelte';

describe('ContactForm', () => {
	it('uses linked client vs employer labels and autofills company from client', async () => {
		render(ContactFormTestHost, {
			clientOptions: [{ id: 'client-1', name: 'Northwind Traders' }]
		});

		await expect.element(page.getByLabelText('Linked client')).toBeInTheDocument();
		await expect.element(page.getByLabelText('Employer / company')).toBeInTheDocument();

		await page.getByTestId('client-picker-input').click();
		await page.getByText('Northwind Traders').click();

		await expect.element(page.getByLabelText('Employer / company')).toHaveValue(
			'Northwind Traders'
		);
	});

	it('does not overwrite an existing employer when selecting a client', async () => {
		render(ContactFormTestHost, {
			initial: { company: 'Existing employer' },
			clientOptions: [{ id: 'client-1', name: 'Northwind Traders' }]
		});

		await page.getByTestId('client-picker-input').click();
		await page.getByText('Northwind Traders').click();

		await expect.element(page.getByLabelText('Employer / company')).toHaveValue(
			'Existing employer'
		);
	});
});
