import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import OrgSwitcher from './org-switcher.svelte';
import OrgSwitcherStoryHost from './org-switcher.story-host.svelte';
import type { OrgMembershipSummary } from '$lib/schemas/organisation.js';

const memberships: OrgMembershipSummary[] = [
	{
		org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		org_name: 'Corrin Data',
		org_slug: 'corrin-data',
		role: 'owner'
	},
	{
		org_id: '11111111-2222-4333-8444-555555555555',
		org_name: 'Certivue Extremely Long Organisation Name That Truncates',
		org_slug: 'certivue',
		role: 'member'
	}
];

describe('OrgSwitcher', () => {
	it('switches organisation via menu callback', async () => {
		const onSwitchOrg = vi.fn();
		render(OrgSwitcher, {
			currentOrgId: memberships[0]!.org_id,
			memberships,
			onSwitchOrg
		});

		await page.getByTestId('org-switcher-trigger').click();
		await page.getByTestId(`org-switch-${memberships[1]!.org_id}`).click();
		await vi.waitFor(() =>
			expect(onSwitchOrg).toHaveBeenCalledWith(memberships[1]!.org_id)
		);
	});

	it('surfaces switch failure and create action', async () => {
		const onCreateOrg = vi.fn();
		render(OrgSwitcher, {
			currentOrgId: memberships[0]!.org_id,
			memberships,
			switchError: 'Could not switch organisation',
			onCreateOrg
		});

		await expect.element(page.getByTestId('org-switcher-error')).toBeInTheDocument();
		await page.getByTestId('org-switcher-trigger').click();
		await page.getByTestId('org-switcher-create').click();
		await vi.waitFor(() => expect(onCreateOrg).toHaveBeenCalled());
	});

	it('keeps the create drawer open when create fails', async () => {
		render(OrgSwitcherStoryHost, {
			currentOrgId: memberships[0]!.org_id,
			memberships: [memberships[0]!],
			failCreate: true
		});

		await page.getByTestId('org-switcher-trigger').click();
		await page.getByTestId('org-switcher-create').click();
		await expect.element(page.getByTestId('organisation-create-drawer')).toBeInTheDocument();

		await page.getByLabelText('Name').fill('Certivue');
		await page.getByTestId('organisation-create-submit').click();

		await expect.element(page.getByTestId('organisation-create-error')).toBeInTheDocument();
		await expect.element(page.getByTestId('organisation-create-drawer')).toBeInTheDocument();
	});

	it('keeps the drawer open when create rejects and does not double-submit', async () => {
		const onCreateAttempt = vi.fn();
		render(OrgSwitcherStoryHost, {
			currentOrgId: memberships[0]!.org_id,
			memberships: [memberships[0]!],
			rejectCreate: true,
			createDelayMs: 400,
			onCreateAttempt
		});

		await page.getByTestId('org-switcher-trigger').click();
		await page.getByTestId('org-switcher-create').click();
		await page.getByLabelText('Name').fill('Slow Reject Org');
		const submit = page.getByTestId('organisation-create-submit');
		await submit.click();

		await expect.element(submit).toHaveTextContent(/Creating/i);
		await expect.element(submit).toBeDisabled();
		// Second click while pending must not start another create.
		await submit.click({ force: true }).catch(() => undefined);
		await expect.element(page.getByTestId('organisation-create-error')).toBeInTheDocument();
		await expect.element(page.getByTestId('organisation-create-drawer')).toBeInTheDocument();
		await expect.element(submit).not.toBeDisabled();
		expect(onCreateAttempt).toHaveBeenCalledTimes(1);
	});

	it('selects and opens configuration after successful create', async () => {
		render(OrgSwitcherStoryHost, {
			currentOrgId: memberships[0]!.org_id,
			memberships: [memberships[0]!]
		});

		await page.getByTestId('org-switcher-trigger').click();
		await page.getByTestId('org-switcher-create').click();
		await page.getByLabelText('Name').fill('Certivue Labs');
		await page.getByTestId('organisation-create-submit').click();

		await expect
			.element(page.getByTestId('org-create-opened-config'))
			.toHaveTextContent(/Opened configuration for Certivue Labs/i);
		await expect
			.element(page.getByTestId('org-switcher-trigger'))
			.toHaveTextContent(/Certivue Labs/i);
	});
});
