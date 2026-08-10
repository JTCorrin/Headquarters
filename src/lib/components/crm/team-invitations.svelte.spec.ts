import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ApiOrganisationInvitation } from '$lib/api/v1/types.js';
import TeamInvitations from './team-invitations.svelte';

const invitation: ApiOrganisationInvitation = {
	id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
	org_id: '11111111-2222-4333-8444-555555555555',
	email: 'alex@example.com',
	role: 'member',
	invited_by: '22222222-3333-4444-8555-666666666666',
	expires_at: '2026-08-17T12:00:00.000Z',
	accepted_at: null,
	accepted_by: null,
	revoked_at: null,
	revoked_by: null,
	created_at: '2026-08-10T12:00:00.000Z',
	updated_at: '2026-08-10T12:00:00.000Z'
};

describe('TeamInvitations', () => {
	it('validates and submits an invitation', async () => {
		const onInvite = vi.fn(async () => true);
		render(TeamInvitations, { onInvite, outboundReady: true });

		await page.getByTestId('team-invite-submit').click();
		await expect.element(page.getByTestId('team-invite-error')).toHaveTextContent(/valid email/i);

		await page.getByTestId('team-invite-email').fill('New.Person@Example.com');
		await page.getByTestId('team-invite-submit').click();
		await vi.waitFor(() =>
			expect(onInvite).toHaveBeenCalledWith('new.person@example.com', 'member')
		);
	});

	it('blocks invites when mailbox SMTP is not configured', async () => {
		const onInvite = vi.fn(async () => true);
		render(TeamInvitations, { onInvite, outboundReady: false });

		await expect.element(page.getByTestId('team-invite-mailbox-warning')).toBeVisible();
		await expect.element(page.getByTestId('team-invite-submit')).toBeDisabled();
		expect(onInvite).not.toHaveBeenCalled();
	});

	it('lists pending invitations and confirms revocation', async () => {
		const onRevoke = vi.fn(async () => true);
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		render(TeamInvitations, { invitations: [invitation], onRevoke, outboundReady: true });

		await expect
			.element(page.getByTestId(`team-invitation-${invitation.id}`))
			.toHaveTextContent('alex@example.com');
		await page.getByTestId(`team-invitation-revoke-${invitation.id}`).click();
		expect(confirmSpy).toHaveBeenCalled();
		expect(onRevoke).toHaveBeenCalledWith(invitation);
		confirmSpy.mockRestore();
	});
});
