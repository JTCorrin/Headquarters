import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server.js';

const url = new URL('https://example.test/invite/accept?token=crm_inv_test');
const session = { access_token: 'access-token' };
const user = { id: 'user-id', email: 'invited@example.com' };

function locals(authenticated = true) {
	return {
		getValidatedSession: vi.fn(async () =>
			authenticated ? { session, user } : { session: null, user: null }
		)
	};
}

describe('/invite/accept server flow', () => {
	it('shows a guest landing instead of forcing login when signed out', async () => {
		const fetch = vi.fn();
		const result = await load({ fetch, locals: locals(false), url } as never);

		expect(fetch).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			needsAuth: true,
			hasToken: true,
			nextPath: '/invite/accept?token=crm_inv_test',
			error: null,
			userEmail: null
		});
	});

	it('does not consume the invitation during GET load when signed in', async () => {
		const fetch = vi.fn();
		const result = await load({ fetch, locals: locals(true), url } as never);

		expect(fetch).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			needsAuth: false,
			error: null,
			userEmail: 'invited@example.com'
		});
	});

	it('accepts the invitation only through the POST action', async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				data: {
					organisation_id: '11111111-2222-4333-8444-555555555555',
					membership_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
					role: 'member',
					status: 'active',
					joined_at: '2026-08-10T10:00:00.000Z'
				}
			})
		);

		const result = await actions.default({ fetch, locals: locals(true), url } as never);

		expect(fetch).toHaveBeenCalledWith(
			'/api/v1/invitations/accept',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ token: 'crm_inv_test' })
			})
		);
		expect(result).toMatchObject({
			acceptance: {
				organisation_id: '11111111-2222-4333-8444-555555555555'
			}
		});
	});
});
