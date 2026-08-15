import { expect, test } from '@playwright/test';
import { readE2EEnv } from './helpers/e2e-env.js';

const env = readE2EEnv();

test.describe('CRM auth guard (staging)', () => {
	test.skip(
		!env,
		'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required'
	);

	test('unauthenticated /contacts redirects to sign in', async ({ page }) => {
		await page.goto('/contacts');
		await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
		await expect(page.getByTestId('auth-email')).toBeVisible();
	});
});
