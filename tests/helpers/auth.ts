import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { isPostOrgCreateLandingPath, isPostSignupLandingPath } from '../../src/lib/auth/paths.js';
import { isSelectedOrgStorageKey } from '../../src/lib/org/selected-org.js';
import { uniqueProofEmail } from './e2e-env.js';

export type E2ESession = {
	email: string;
	password: string;
};

export function pagePathname(page: Page): string {
	return new URL(page.url()).pathname;
}

/** Read the selected org id from unscoped or `hq.selected-org-id:<userId>` keys. */
async function persistedSelectedOrgId(page: Page): Promise<string | null> {
	const entries = await page.evaluate(() => {
		const out: [string, string][] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			const value = localStorage.getItem(key);
			if (value) out.push([key, value]);
		}
		return out;
	});
	for (const [key, value] of entries) {
		const trimmed = value.trim();
		if (isSelectedOrgStorageKey(key) && trimmed) return trimmed;
	}
	return null;
}

/** Sign up a fresh user via the UI (staging has email confirmations off). */
export async function signupViaUi(page: Page): Promise<E2ESession> {
	const email = uniqueProofEmail();
	const password = 'E2eProofPass123!';

	await page.goto('/signup');
	await page.getByTestId('auth-display-name').fill('E2E User');
	await page.getByTestId('auth-email').fill(email);
	await page.getByTestId('auth-password').fill(password);
	await page.getByTestId('auth-submit').click();

	// New users land on create-org (0 memberships). `/check-email` means
	// staging still has `enable_confirmations = true` — that is a real failure.
	await expect
		.poll(
			() => {
				const path = pagePathname(page);
				if (path.startsWith('/check-email')) return 'check-email';
				return isPostSignupLandingPath(path) ? 'ok' : path;
			},
			{ timeout: 30_000 }
		)
		.toBe('ok');
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
 * Success is `/onboarding/invite-team` (current product path). If selection is
 * persisted but client navigation stalls, fall back to a hard navigation there
 * rather than `/` — a full reload of home can race membership discovery.
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
			response.url().includes('/api/v1/organisations') && response.request().method() === 'POST',
		{ timeout: 45_000 }
	);
	await page.getByTestId('organisation-create-submit').click();
	const response = await createResponse;
	expect(response.ok(), `org create HTTP ${response.status()}`).toBeTruthy();

	const landed = () => isPostOrgCreateLandingPath(pagePathname(page));
	// Do not auto-wait `onboarding-create-error` here: that node is absent on
	// success, so a 45s locator wait consumes the whole poll and never sees
	// the invite-team navigation or persisted org id.
	await page
		.waitForURL((url) => isPostOrgCreateLandingPath(new URL(url).pathname), { timeout: 8_000 })
		.catch(() => undefined);

	const createError = await page
		.getByTestId('onboarding-create-error')
		.textContent({ timeout: 0 })
		.catch(() => null);
	if (createError?.trim()) {
		throw new Error(`Organisation create failed: ${createError.trim()}`);
	}

	if (!landed()) {
		await page.goto('/onboarding/invite-team');
	}

	await expect.poll(landed, { timeout: 45_000 }).toBe(true);
	expect(
		pagePathname(page),
		`selected org id=${await persistedSelectedOrgId(page)}`
	).not.toBe('/onboarding/create-org');
}

/** Bootstrap: signup → create org → ready for CRM journeys. */
export async function bootstrapOwnerSession(page: Page): Promise<E2ESession & { orgSlug: string }> {
	const session = await signupViaUi(page);
	const slug = `e2e-${Date.now().toString(36)}`;
	if (pagePathname(page) === '/onboarding/create-org') {
		await createOrgViaUi(page, { name: `E2E Org ${slug}`, slug });
	}
	return { ...session, orgSlug: slug };
}
