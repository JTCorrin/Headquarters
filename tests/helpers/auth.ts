import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { uniqueProofEmail, type E2EEnv } from './e2e-env.js';

export type E2ESession = {
	email: string;
	password: string;
};

/** Sign up a fresh user via the UI (staging has email confirmations off). */
export async function signupViaUi(page: Page, env: E2EEnv): Promise<E2ESession> {
	const email = env.userEmail ?? uniqueProofEmail();
	const password = env.userPassword ?? 'E2eProofPass123!';

	await page.goto('/signup');
	await page.getByTestId('auth-display-name').fill('E2E User');
	await page.getByTestId('auth-email').fill(email);
	await page.getByTestId('auth-password').fill(password);
	await page.getByTestId('auth-submit').click();

	// New users land on create-org (0 memberships) or home if a seeded user already has orgs.
	// Email confirmation must be off on staging (`enable_confirmations = false`) so signup returns a session.
	await expect(page).toHaveURL(/\/(onboarding\/create-org|select-org|$)/, { timeout: 30_000 });
	return { email, password };
}

export async function signInViaUi(page: Page, session: E2ESession): Promise<void> {
	await page.goto('/login');
	await page.getByTestId('auth-email').fill(session.email);
	await page.getByTestId('auth-password').fill(session.password);
	await page.getByTestId('auth-submit').click();
	await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
}

/**
 * Create first org through onboarding UI and wait for an authenticated app shell.
 *
 * Staging historically persisted `hq.selected-org-id` after a successful POST but
 * failed to client-navigate (goto raced the layout guard / Superforms enhance).
 * Prefer URL change; fall back to a hard navigation once selection is persisted.
 */
export async function createOrgViaUi(
	page: Page,
	options: { name: string; slug: string }
): Promise<void> {
	if (!page.url().includes('/onboarding/create-org')) {
		await page.goto('/onboarding/create-org');
	}
	await expect(page.getByTestId('organisation-create-form')).toBeVisible({ timeout: 30_000 });
	await page.locator('#org-create-name').fill(options.name);
	await page.locator('#org-create-slug').fill(options.slug);

	const createResponse = page.waitForResponse(
		(response) =>
			response.url().includes('/api/v1/organisations') &&
			response.request().method() === 'POST',
		{ timeout: 45_000 }
	);
	await page.getByTestId('organisation-create-submit').click();
	const response = await createResponse;
	expect(response.ok(), `org create HTTP ${response.status()}`).toBeTruthy();

	await expect
		.poll(async () => page.evaluate(() => localStorage.getItem('hq.selected-org-id')), {
			timeout: 45_000
		})
		.toBeTruthy();

	if (page.url().includes('/onboarding/create-org')) {
		await page.goto('/');
	}

	await expect(page).toHaveURL(/\/(org\/config|$|contacts|select-org)/, { timeout: 45_000 });
	await expect(page).not.toHaveURL(/\/onboarding\/create-org/);
}

/** Bootstrap: signup → create org → ready for CRM journeys. */
export async function bootstrapOwnerSession(
	page: Page,
	env: E2EEnv
): Promise<E2ESession & { orgSlug: string }> {
	const session = await signupViaUi(page, env);
	const slug = `e2e-${Date.now().toString(36)}`;
	if (page.url().includes('/onboarding/create-org') || !env.orgId) {
		await createOrgViaUi(page, { name: `E2E Org ${slug}`, slug });
	}
	return { ...session, orgSlug: slug };
}
