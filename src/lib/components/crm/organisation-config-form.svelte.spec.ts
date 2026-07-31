import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import OrganisationConfigFormTestHost from './organisation-config-form.test-host.svelte';

describe('OrganisationConfigForm', () => {
	it('awaits delayed save, stays pending, and rejects a second click', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const onValidSubmit = vi.fn(async () => {
			await gate;
			return true;
		});
		render(OrganisationConfigFormTestHost, { onValidSubmit });

		const submit = page.getByTestId('organisation-config-submit');
		await submit.click();
		await expect.element(submit).toHaveTextContent(/Saving/i);
		await expect.element(submit).toBeDisabled();
		await submit.click({ force: true }).catch(() => undefined);
		expect(onValidSubmit).toHaveBeenCalledTimes(1);
		release();
		await vi.waitFor(() => expect(onValidSubmit).toHaveBeenCalledTimes(1));
		await expect.element(submit).not.toBeDisabled();
	});

	it('contains rejection without unhandled error and allows retry', async () => {
		const onValidSubmit = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			throw new Error('save failed');
		});
		render(OrganisationConfigFormTestHost, { onValidSubmit });

		const submit = page.getByTestId('organisation-config-submit');
		await submit.click();
		await vi.waitFor(() => expect(onValidSubmit).toHaveBeenCalledTimes(1));
		await expect.element(submit).not.toBeDisabled();
		await submit.click();
		await vi.waitFor(() => expect(onValidSubmit).toHaveBeenCalledTimes(2));
	});
});
