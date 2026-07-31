import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import OrganisationCreateFormTestHost from './organisation-create-form.test-host.svelte';

describe('OrganisationCreateForm', () => {
	it('surfaces validation when name is missing', async () => {
		render(OrganisationCreateFormTestHost, {
			initial: { name: '', slug: '' }
		});
		await page.getByTestId('organisation-create-submit').click();
		await expect.element(page.getByText(/name is required/i)).toBeInTheDocument();
	});

	it('calls onValidSubmit after a valid create', async () => {
		const onValidSubmit = vi.fn();
		render(OrganisationCreateFormTestHost, {
			initial: {
				name: 'Corrin Data',
				slug: 'corrin-data',
				timezone: 'Europe/London',
				currency: 'GBP',
				locale: 'en-GB',
				country: 'GB'
			},
			onValidSubmit
		});

		await page.getByTestId('organisation-create-submit').click();
		await vi.waitFor(() => expect(onValidSubmit).toHaveBeenCalled());
	});
});
