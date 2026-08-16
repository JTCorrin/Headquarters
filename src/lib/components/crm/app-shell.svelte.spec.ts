import { describe, expect, it, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import AppShell from './app-shell.svelte';
import type { OrgMembershipSummary } from '$lib/schemas/organisation.js';
import type { AppNavGroup } from './app-nav.svelte';

const memberships: OrgMembershipSummary[] = [
	{
		org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		org_name: 'Acme Org',
		org_slug: 'acme',
		role: 'owner',
		theme_default: 'system'
	}
];

const navGroups: AppNavGroup[] = [
	{
		items: [
			{ label: 'Dashboard', href: '/', active: true },
			{ label: 'Clients', href: '/clients' }
		]
	}
];

describe('AppShell sidebar', () => {
	afterEach(async () => {
		await page.viewport(1280, 720);
	});

	it('opens and closes the mobile nav sheet', async () => {
		await page.viewport(390, 844);
		await expect
			.poll(() => window.matchMedia('(max-width: 767px)').matches)
			.toBe(true);

		render(AppShell, {
			currentOrgId: memberships[0]!.org_id,
			memberships,
			orgName: 'Acme Org',
			navGroups,
			onLogout: () => undefined
		});

		await expect.element(page.getByTestId('app-sidebar-trigger')).toBeInTheDocument();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

		await page.getByTestId('app-sidebar-trigger').click();
		await expect.element(page.getByRole('dialog')).toBeVisible();
		await expect.element(page.getByRole('dialog').getByText('Headquarters')).toBeVisible();

		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('keeps a persistent sidebar on desktop', async () => {
		await page.viewport(1280, 800);

		render(AppShell, {
			currentOrgId: memberships[0]!.org_id,
			memberships,
			orgName: 'Acme Org',
			navGroups
		});

		await expect.element(page.getByText('Headquarters')).toBeVisible();
		await expect.element(page.getByTestId('app-sidebar-trigger')).toBeInTheDocument();
	});
});
