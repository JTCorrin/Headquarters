import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import OrgSwitcher from './org-switcher.svelte';
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
});
