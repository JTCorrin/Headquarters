import { expect, test } from '@playwright/test';
import { bootstrapOwnerSession } from './helpers/auth.js';
import { readE2EEnv } from './helpers/e2e-env.js';

const env = readE2EEnv();

test.describe('CRM contacts journey (staging)', () => {
	test.skip(!env, 'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required');

	test('create a contact via UI (browser → proxy → Edge → DB)', async ({ page }) => {
		await bootstrapOwnerSession(page, env!);

		await page.goto('/contacts');
		await expect(page.getByTestId('contacts-page')).toBeVisible({ timeout: 45_000 });

		// Prefer an explicit create control when present; otherwise open /contacts with ?create or form.
		const createButton = page.getByRole('button', { name: /new contact|add contact|create/i });
		if (await createButton.count()) {
			await createButton.first().click();
		}

		const form = page.getByTestId('contact-form');
		await expect(form).toBeVisible({ timeout: 30_000 });

		const displayName = `E2E Contact ${Date.now()}`;
		await form.locator('input[name="name"]').fill(displayName);
		const emailField = form.locator('input[name="email"]');
		if (await emailField.count()) {
			await emailField.fill(`contact-${Date.now()}@example.test`);
		}

		await form.locator('button[type="submit"]').click();

		// Success: list/detail shows the new contact name (proxy+Edge+DB round-trip).
		await expect(page.getByText(displayName).first()).toBeVisible({ timeout: 45_000 });
	});
});
