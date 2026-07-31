import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ProfilePreferencesFormTestHost from './profile-preferences-form.test-host.svelte';

describe('ProfilePreferencesForm', () => {
	it('awaits delayed save, stays pending, and rejects a second click', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const onValidSubmit = vi.fn(async () => {
			await gate;
			return true;
		});
		render(ProfilePreferencesFormTestHost, { onValidSubmit });

		const submit = page.getByTestId('profile-preferences-submit');
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
		render(ProfilePreferencesFormTestHost, { onValidSubmit });

		const submit = page.getByTestId('profile-preferences-submit');
		await submit.click();
		await vi.waitFor(() => expect(onValidSubmit).toHaveBeenCalledTimes(1));
		await expect.element(submit).not.toBeDisabled();
		await submit.click();
		await vi.waitFor(() => expect(onValidSubmit).toHaveBeenCalledTimes(2));
	});
});
