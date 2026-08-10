import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ApiOrganisationManagedMember } from '$lib/api/v1/types.js';
import OrgTeamPage from './org-team-page.svelte';

const member: ApiOrganisationManagedMember = {
	id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
	org_id: '11111111-2222-4333-8444-555555555555',
	user_id: '22222222-3333-4444-8555-666666666666',
	display_name: 'Alex Example',
	email: 'alex@example.com',
	role: 'member',
	status: 'active',
	job_title: null,
	joined_at: '2026-08-01T10:00:00.000Z',
	suspended_at: null,
	created_at: '2026-08-01T10:00:00.000Z',
	updated_at: '2026-08-01T10:00:00.000Z'
};

describe('OrgTeamPage', () => {
	it('restores the role select when an update fails', async () => {
		const onUpdateMember = vi.fn(async () => false);
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		render(OrgTeamPage, {
			role: 'owner',
			currentMembershipId: 'owner-membership',
			members: [member],
			onUpdateMember
		});

		const select = page.getByTestId(`team-member-role-${member.id}`);
		await select.selectOptions('readonly');

		await vi.waitFor(() =>
			expect(onUpdateMember).toHaveBeenCalledWith(member, { role: 'readonly' })
		);
		await expect.element(select).toHaveValue('member');
		vi.restoreAllMocks();
	});
});
