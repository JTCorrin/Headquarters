import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { isPostSignupLandingPath } from '../../src/lib/auth/paths.js';
import { isSelectedOrgStorageKey } from '../../src/lib/org/selected-org.js';
import { uniqueProofEmail } from './e2e-env.js';

const POST_ORG_CREATE_PATH = '/onboarding/invite-team';

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
 * Success is exactly `/onboarding/invite-team` (the current product path).
 * If selection is persisted but client navigation stalls, recover with one
 * bounded navigation there rather than reloading home during membership discovery.
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

	const landed = () => pagePathname(page) === POST_ORG_CREATE_PATH;
	let createError: string | null = null;
	await expect
		.poll(
			async () => {
				if (landed()) return 'ready';
				createError = await page
					.getByTestId('onboarding-create-error')
					.textContent({ timeout: 0 })
					.catch(() => null);
				if (createError?.trim()) return 'ready';
				return (await persistedSelectedOrgId(page)) ? 'ready' : 'waiting';
			},
			{ timeout: 8_000 }
		)
		.toBe('ready')
		.catch(() => undefined);

	if (createError?.trim()) {
		throw new Error(`Organisation create failed: ${createError.trim()}`);
	}

	const selectedOrgId = await persistedSelectedOrgId(page);
	if (!landed()) {
		if (!selectedOrgId) {
			throw new Error(
				`Organisation create POST returned HTTP ${response.status()}, but selection was not persisted (path=${pagePathname(page)})`
			);
		}

		try {
			await page.goto(POST_ORG_CREATE_PATH, { waitUntil: 'commit', timeout: 15_000 });
		} catch (error) {
			throw new Error(
				`Organisation create recovery navigation failed (HTTP ${response.status()}, path=${pagePathname(page)}, selectedOrgId=${selectedOrgId})`,
				{ cause: error }
			);
		}
	}

	await expect(page).toHaveURL((url) => url.pathname === POST_ORG_CREATE_PATH, {
		timeout: 15_000
	});
	await expect(page.getByTestId('onboarding-invite-skip')).toBeVisible({ timeout: 30_000 });
	expect(pagePathname(page), `selected org id=${selectedOrgId}`).toBe(POST_ORG_CREATE_PATH);
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
