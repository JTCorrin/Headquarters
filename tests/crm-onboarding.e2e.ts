import { expect, test } from '@playwright/test';
import { bootstrapOwnerSession } from './helpers/auth.js';
import { readE2EEnv } from './helpers/e2e-env.js';

const env = readE2EEnv();

test.describe('CRM onboarding journey (staging)', () => {
	test.skip(!env, 'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required');

	test('signup → create organisation → reach authenticated shell', async ({ page }) => {
		const session = await bootstrapOwnerSession(page, env!);
		expect(session.email).toContain('@example.test');

		// Org-scoped chrome should load without bouncing to login.
		await page.goto('/');
		await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
		await expect(page).toHaveURL(/\/(select-org|$|org\/|contacts|tasks)/);
		await expect(page.locator('body')).toBeVisible();
	});

	test('sign-in after signup reaches an org-scoped route', async ({ page, context }) => {
		const session = await bootstrapOwnerSession(page, env!);
		// Supabase stores the session in localStorage; cookies alone are not enough.
		await context.clearCookies();
		await page.goto('/login');
		await page.evaluate(() => {
			localStorage.clear();
			sessionStorage.clear();
		});
		await page.goto('/login');
		await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 30_000 });
		await page.getByTestId('auth-email').fill(session.email);
		await page.getByTestId('auth-password').fill(session.password);
		await page.getByTestId('auth-submit').click();
		await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
		await expect(page).toHaveURL(/\/(select-org|$|org\/|contacts|tasks)/);
	});
});
