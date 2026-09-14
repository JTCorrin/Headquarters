import { expect } from '@playwright/test';

import { readE2EEnv } from './helpers/e2e-env.js';
import { test } from './helpers/owner-fixture.js';

const env = readE2EEnv();

test.describe('CRM notes journey (staging)', () => {
	test.skip(
		!env,
		'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required'
	);

	test('create a note, autosave the title, and see it in the grid', async ({ page }) => {
		const title = `E2E Note ${Date.now()}`;

		await page.goto('/notes');
		await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
		await expect(page.getByTestId('notes-page')).toBeVisible();

		const created = page.waitForResponse(
			(response) =>
				response.url().includes('/api/v1/notes') && response.request().method() === 'POST',
			{ timeout: 45_000 }
		);
		await page.getByTestId('notes-new').click();
		const createResponse = await created;
		expect(createResponse.ok(), `/api/v1/notes HTTP ${createResponse.status()}`).toBeTruthy();

		await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 45_000 });
		await expect(page.getByTestId('note-page')).toBeVisible();

		const patched = page.waitForResponse(
			(response) =>
				/\/api\/v1\/notes\/[0-9a-f-]{36}$/.test(response.url()) &&
				response.request().method() === 'PATCH',
			{ timeout: 45_000 }
		);
		await page.getByTestId('note-title').fill(title);
		const patchResponse = await patched;
		expect(patchResponse.ok(), `PATCH note HTTP ${patchResponse.status()}`).toBeTruthy();
		await expect(page.getByTestId('note-save-status')).toHaveText(/saved/i, { timeout: 15_000 });

		await page.getByRole('link', { name: 'Notes' }).first().click();
		await expect(page.getByTestId('notes-page')).toBeVisible({ timeout: 45_000 });
		await expect(page.getByText(title).first()).toBeVisible({ timeout: 45_000 });
	});
});
