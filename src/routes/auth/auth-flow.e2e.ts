import { expect, test } from '@playwright/test';

test('signup exposes password, social, and enterprise SSO entry points', async ({ page }) => {
	await page.goto('/signup?next=%2Finvite%2Faccept%3Ftoken%3Dtest-token');

	await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeVisible();
	await expect(page.getByLabel('Company domain')).toBeVisible();

	await page.getByLabel('Display name').fill('Invitee User');
	await page.getByLabel('Email').fill('invitee@example.test');
	await page.getByLabel('Password').fill('a-secure-password');
	await page.getByRole('button', { name: 'Sign up' }).click();

	await expect(page.getByRole('alert')).toContainText('Auth is not configured');
	await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
		'href',
		'/login?next=%2Finvite%2Faccept%3Ftoken%3Dtest-token'
	);
});

test('password recovery is generic and links back to sign in', async ({ page }) => {
	await page.goto('/forgot-password?next=%2Fselect-org');

	await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
		'href',
		'/login?next=%2Fselect-org'
	);
});
