import { expect, test } from '@playwright/test';

/**
 * Local preview smoke for auth chrome when Supabase public env is unset.
 * Staging journeys live in `tests/crm-onboarding.e2e.ts` (real Auth + secrets).
 */
const againstStaging = Boolean(process.env.E2E_BASE_URL?.trim());

test.describe('auth flow UI (local preview)', () => {
	test.skip(againstStaging, 'Staging uses CRM onboarding/auth journeys with live Supabase');

	test('signup exposes password, social, and enterprise SSO entry points', async ({ page }) => {
		await page.goto('/signup?next=%2Finvite%2Faccept%3Ftoken%3Dtest-token');

		await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeVisible();
		await expect(page.getByLabel('Company domain')).toBeVisible();

		await page.getByTestId('auth-display-name').fill('Invitee User');
		await page.getByTestId('auth-email').fill('invitee@example.test');
		await page.getByTestId('auth-password').fill('a-secure-password');
		await page.getByTestId('auth-submit').click();

		await expect(page.getByTestId('auth-form-error')).toContainText('Auth is not configured');
		await expect(page.getByTestId('auth-goto-login')).toHaveAttribute(
			'href',
			'/login?next=%2Finvite%2Faccept%3Ftoken%3Dtest-token'
		);
	});

	test('password recovery is generic and links back to sign in', async ({ page }) => {
		await page.goto('/forgot-password?next=%2Fselect-org');

		await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
			'href',
			'/login?next=%2Fselect-org'
		);
	});
});
