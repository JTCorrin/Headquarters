import { expect } from '@playwright/test';
import { readE2EEnv } from './helpers/e2e-env.js';
import { test } from './helpers/owner-fixture.js';

const env = readE2EEnv();

test.describe('CRM shell (staging)', () => {
	test.skip(
		!env,
		'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required'
	);

	test('home dashboard and org-scoped CRM pages load', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
		await expect(page.getByTestId('dashboard-home-page')).toBeVisible();

		await page.goto('/contacts');
		await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
		await expect(page.getByTestId('contacts-page')).toBeVisible();
		await expect(page.getByRole('button', { name: 'New contact' })).toBeVisible();

		await page.goto('/clients');
		await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
		await expect(page.getByTestId('clients-page')).toBeVisible();

		await page.goto('/leads');
		await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
		await expect(page.getByTestId('leads-page')).toBeVisible();
	});

	test('log out returns to sign in', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('auth-logout')).toBeVisible({ timeout: 45_000 });
		await page.getByTestId('auth-logout').click();
		await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
		await expect(page.getByTestId('auth-email')).toBeVisible();
	});
});
