import { expect, test } from '@playwright/test';
import { bootstrapOwnerSession, pagePathname, signInViaUi } from './helpers/auth.js';
import { readE2EEnv } from './helpers/e2e-env.js';

const env = readE2EEnv();
const POST_ORG_CREATE_PATH = '/onboarding/invite-team';

test.describe('CRM onboarding journey (staging)', () => {
	test.skip(
		!env,
		'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required'
	);

	test('signup → create organisation → reach authenticated shell', async ({ page }) => {
		const session = await bootstrapOwnerSession(page);
		expect(session.email).toContain('@example.test');
		expect(pagePathname(page)).toBe(POST_ORG_CREATE_PATH);

		await page.getByTestId('onboarding-invite-skip').click();
		await expect(page).toHaveURL(/\/org\/config/, { timeout: 30_000 });

		await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });

		await page.goto('/');
		await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
		await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
		await expect(page.getByTestId('dashboard-home-page')).toBeVisible();
	});

	test('sign-in after signup reaches an org-scoped route', async ({ page, browser }) => {
		if (!env) return;
		const session = await bootstrapOwnerSession(page);
		const isolated = await browser.newContext({ baseURL: env.baseURL });
		try {
			const loginPage = await isolated.newPage();
			await signInViaUi(loginPage, session);
			await expect(loginPage).not.toHaveURL(/\/onboarding\/create-org/, { timeout: 30_000 });
			await expect(
				loginPage.getByTestId('app-shell').or(loginPage.getByTestId('select-org-page'))
			).toBeVisible({ timeout: 45_000 });
		} finally {
			await isolated.close();
		}
	});
});
