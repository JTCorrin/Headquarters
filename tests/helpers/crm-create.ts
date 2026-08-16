import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function createRecordViaDrawer(
	page: Page,
	spec: {
		route: string;
		pageTestId: string;
		triggerName: string;
		formTestId: string;
		name: string;
		nameFieldId: string;
		submitName: string;
		postUrlIncludes: string;
		fillExtra?: (form: Locator) => Promise<void>;
	}
): Promise<void> {
	await page.goto(spec.route);
	await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
	await expect(page.getByTestId(spec.pageTestId)).toBeVisible();

	await page.getByRole('button', { name: spec.triggerName }).click();
	const form = page.getByTestId(spec.formTestId);
	await expect(form).toBeVisible({ timeout: 15_000 });
	await form.locator(`#${spec.nameFieldId}`).fill(spec.name);
	await spec.fillExtra?.(form);

	const posted = page.waitForResponse(
		(response) =>
			response.url().includes(spec.postUrlIncludes) && response.request().method() === 'POST',
		{ timeout: 45_000 }
	);
	await form.getByRole('button', { name: spec.submitName }).click();
	const response = await posted;
	expect(response.ok(), `${spec.postUrlIncludes} HTTP ${response.status()}`).toBeTruthy();
	await expect(page.getByText(spec.name).first()).toBeVisible({ timeout: 45_000 });
}
