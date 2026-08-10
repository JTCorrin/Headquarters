import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthCredentialsFormTestHost from './auth-credentials-form.test-host.svelte';

describe('AuthCredentialsForm', () => {
	it('submits valid credentials through onValidSubmit', async () => {
		const onValidSubmit = vi.fn(async () => true);

		render(AuthCredentialsFormTestHost, {
			submitLabel: 'Sign in',
			onValidSubmit
		});

		await page.getByTestId('auth-email').fill('joe@example.com');
		await page.getByTestId('auth-password').fill('password123');
		await page.getByTestId('auth-submit').click();

		await vi.waitFor(() => {
			expect(onValidSubmit).toHaveBeenCalledOnce();
		});
	});

	it('shows injected error message', async () => {
		render(AuthCredentialsFormTestHost, {
			submitLabel: 'Sign up',
			errorMessage: 'Invalid login credentials'
		});

		await expect
			.element(page.getByTestId('auth-form-error'))
			.toHaveTextContent('Invalid login credentials');
	});

	it('shows a display name field for signup', async () => {
		render(AuthCredentialsFormTestHost, {
			submitLabel: 'Sign up',
			showDisplayName: true
		});

		await expect.element(page.getByTestId('auth-display-name')).toBeVisible();
	});
});
