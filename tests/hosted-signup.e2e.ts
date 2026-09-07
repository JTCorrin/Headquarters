import { expect, test } from './helpers/runtime.js';
test.describe('hosted payment landing', () => {
	test.skip(Boolean(process.env.E2E_BASE_URL), 'Isolated claim responses use local preview');
	test('waits for payment reconciliation and then unlocks signup', async ({ page }) => {
		let lookups = 0;
		await page.route('**/api/hosted/claim?*', (route) =>
			route.fulfill({
				json:
					++lookups === 1
						? { status: 'pending_checkout', usable: false }
						: { status: 'active', email: 'buyer@example.test', usable: true }
			})
		);
		await page.goto('/signup?claim=payment-proof&session_id=cs_test_reference');
		await expect(
			page.getByText('Payment is still processing — refresh in a moment.')
		).toBeVisible();
		await expect(page.getByTestId('auth-email')).toHaveValue('buyer@example.test', {
			timeout: 10000
		});
		await expect(page.getByTestId('auth-goto-login')).toHaveAttribute(
			'href',
			/next=.*billing.*claim.*payment-proof.*session_id.*cs_test_reference/
		);
		expect(lookups).toBe(2);
	});
	test('expired paid claim allows account creation for recovery without repurchase', async ({
		page
	}) => {
		await page.route('**/api/hosted/claim?*', (route) =>
			route.fulfill({
				json: { status: 'active', email: 'buyer@example.test', expired: true, usable: false }
			})
		);
		await page.goto('/signup?claim=expired-proof&session_id=cs_test_expired');
		await expect(page.getByTestId('auth-email')).toHaveValue('buyer@example.test');
		await expect(page.getByTestId('auth-submit')).toBeVisible();
		await expect(
			page.getByText('Start checkout again from the pricing page.', { exact: false })
		).toHaveCount(0);
	});
	test('invalid claim does not expose signup form', async ({ page }) => {
		await page.route('**/api/hosted/claim?*', (route) =>
			route.fulfill({ status: 404, json: { error: 'Claim not found' } })
		);
		await page.goto('/signup?claim=invalid');
		await expect(page.getByRole('alert')).toHaveText('Claim not found');
		await expect(page.getByTestId('auth-submit')).toHaveCount(0);
	});
});
